require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT;
const stripe = require("stripe")(
  "sk_test_51PRWX8Ca24ECLKfEK78mGFBgEBKjWTnbdRhAi7hVnhJZmPgEkuP97H8aV9bObgE3JHtrGJZYE4Ne9MeV3nlMtjs300a3QWgBa7"
);
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// JWT token generation
function generateToken(userInfo) {
  const token = jwt.sign(
    {
      email: userInfo?.email,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
  return token;
}

// verify JWT token

function verifyToken(req, res, next) {
  const token = req.headers.authorization.split(" ")[1];
  const verify = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET); // {email,iat,exp}
  if (!verify?.email) {
    return res.send("Your token is not valid!");
  }
  req.user = verify?.email;

  next();
}

const uri = process.env.DB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect(); // Connect the client to the server

    // create usersDb here
    const booKeVentsDB = client.db("booKeVentsDB");

    // collection for users
    const usersCollection4booKeVentsDB = booKeVentsDB.collection(
      "usersCollection4booKeVentsDB"
    );

    // JWT - final protected POST req for creating a user
    app.post("/api/v1/users", async (req, res) => {
      const user = req.body;
      console.log("currentUser from backend", user);
      user.events = []; // to avoid undefined error
      const token = generateToken(user);
      const query = { email: user?.email };
      const isExistingUser = await usersCollection4booKeVentsDB.findOne(query);
      if (isExistingUser?.email) {
        return res.send({
          status: "Login success",
          message: "User already exists!",
          token,
        });
      }
      const result = await usersCollection4booKeVentsDB.insertOne(user);
      res.send({
        status: "Registration success",
        message: "User created successfully!",
        token,
      });
    });

    // collection for events
    const eventsCollection4BooKeVents = booKeVentsDB.collection(
      "eventsCollection4BooKeVents"
    );

    // GET all events
    app.get("/api/v1/events", async (req, res) => {
      const cursor4EventsData = eventsCollection4BooKeVents.find({});
      const results = await cursor4EventsData.toArray();
      res.send(results);
    });
    // GET event by id
    app.get("/api/v1/events/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const event = await eventsCollection4BooKeVents.findOne(query);
      res.send(event);
    });

    // post booking for an event
    app.post("/api/v1/events/book-event/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const userName = req.body.name;
      // 1-add user to attendees array
      const query = { _id: new ObjectId(id) };
      const event = await eventsCollection4BooKeVents.findOne(query);
      const attendeesArray = event.attendees;

      // 1.2 - if user has already booked this event then return a message
      const isUserBooked = attendeesArray.find(
        (attendee) => attendee?.email === req.user
      );
      if (isUserBooked) {
        return res.send({
          status: false,
          message: "You have already booked this event!",
        });
      }

      const newAttendee = {
        email: req.user,
        name: userName,
        isPaid: false,
        trnxID: "",
      };
      if (event?.price === 0) {
        newAttendee.isPaid = true;
      }
      attendeesArray.push(newAttendee);

      const update = {
        $set: {
          attendees: attendeesArray,
        },
      };
      const result4UpdateEventsColl =
        await eventsCollection4BooKeVents.updateOne(query, update);

      // 2-update the events array in users collection
      const userQuery = { email: req.user };
      const user = await usersCollection4booKeVentsDB.findOne(userQuery);
      const eventsArray = user?.events;

      // 2.2 - if user has no events booked yet of this event-id then book it or if already booked then return a message
      if (eventsArray?.find((event) => event.eventID === id)) {
        return res.send({
          status: false,
          message: "You have already booked this event!",
        });
      }
      // eventsArray.push(event);
      eventsArray.push({
        eventID: id,
        eventTitle: event?.title,
        isPaid: false,
        trnxID: "",
      });
      const userUpdate = {
        $set: {
          events: eventsArray,
        },
      };
      const result4UpdateUsersColl =
        await usersCollection4booKeVentsDB.updateOne(userQuery, userUpdate);

      res.send({
        status: true,
        message: "Event booked successfully!",
      });
    });
    // get my events based on email
    app.get("/api/v1/my-events", verifyToken, async (req, res) => {
      const email = req.user;
      const cursor4AllEventsData = eventsCollection4BooKeVents.find({});
      const result4allEventsArray = await cursor4AllEventsData.toArray();

      // get all events booked by the user based on email
      const myEvents = [];
      result4allEventsArray.forEach((event) => {
        const attendeesArray = event.attendees;
        const isUserBooked = attendeesArray.find(
          (attendee) => attendee?.email === email
        );
        if (isUserBooked) {
          // Clone the event and filter out other attendees
          const eventCopy = { ...event };
          eventCopy.attendees = attendeesArray.filter(
            (attendee) => attendee?.email === email
          );
          myEvents.push(eventCopy);
        }
      });

      res.send(myEvents);
    });

    // patch payment for an event

    const paymentCollectionBooKeVents = booKeVentsDB.collection(
      "paymentCollectionBooKeVents"
    );

    // get all payments
    app.get("/api/v1/payments", verifyToken, async (req, res) => {
      const cursor4allPayments = paymentCollectionBooKeVents.find({});
      const allPaymentsArray = await cursor4allPayments.toArray();
      res.send(allPaymentsArray);
    });

    // create payment from strip default
    app.post("/api/v1/events/pay-event/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const userEmail = req.user;
      // 1-update isPaid to true and add trnxID to the attendee of an event
      const query = { _id: new ObjectId(id) };
      const event = await eventsCollection4BooKeVents.findOne(query);
      const eventPrice = event.price * 100; // 100 usd cent

      try {
        // step4stripe-1 create product
        const product = await stripe.products.create({
          name: event.title,
          description: event.description,
          active: true, // Optional: Whether the product is currently available (defaults to true)
          metadata: {
            // Optional: Custom key-value pairs for additional information
            category: "event",
            location: "New York",
          },
          images: [event.image], // Optional: Image URLs
        });

        // step4stripe-2 create price
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: eventPrice, // 100 usd cent
          currency: "usd",
        });

        // step4stripe-3 create checkout session
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price: price.id,
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `https://boo-ke-vents.netlify.app/success/${id}/${userEmail}`,
          cancel_url: "https://boo-ke-vents.netlify.app/cancel",
          customer_email: userEmail,
        });

        res.json({ url: session.url });
      } catch (error) {
        console.error("Error creating payment session:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // patch payment for an event in db

    app.patch(
      "/api/v1/events/payment-succcess/:id",
      verifyToken,
      async (req, res) => {
        const { id } = req.params;
        const userEmail = req.user;
        // const paymentInfo = req.body;

        // check is already paid or not
        const cursor4allPayments = paymentCollectionBooKeVents.find({});
        const allPaymentsArray = await cursor4allPayments.toArray();

        // check each payment if eventID and email matches then return a message
        const isAlreadyPaid = allPaymentsArray.find(
          (payment) => payment?.eventID === id && payment?.email === userEmail
        );

        if (isAlreadyPaid) {
          return res.send({
            status: false,
            message: "You have already paid for this event!",
          });
        }

        // 1-update isPaid to true and add trnxID to the attendee of an event
        const query = { _id: new ObjectId(id) };
        const event = await eventsCollection4BooKeVents.findOne(query);

        const attendeesArray = event.attendees;
        const attendeeIndex = attendeesArray.findIndex(
          (attendee) => attendee?.email === userEmail
        );

        attendeesArray[attendeeIndex].isPaid = true;
        // attendeesArray[attendeeIndex].trnxID = paymentInfo.trnxID;

        const update = {
          $set: {
            attendees: attendeesArray,
          },
        };
        const result4UpdateEventsColl =
          await eventsCollection4BooKeVents.updateOne(query, update);

        // 2-update the events array in users collection
        const userQuery = { email: userEmail };
        const user = await usersCollection4booKeVentsDB.findOne(userQuery);
        const eventsArray = user.events;
        const eventIndex = eventsArray.findIndex(
          (event) => event?.eventID === id
        );
        eventsArray[eventIndex].isPaid = true;
        // eventsArray[eventIndex].trnxID = paymentInfo.trnxID;
        const userUpdate = {
          $set: {
            events: eventsArray,
          },
        };
        const result4UpdateUsersColl =
          await usersCollection4booKeVentsDB.updateOne(userQuery, userUpdate);

        //3 - post payment to payment collection
        const payment = {
          email: userEmail,
          eventID: id,
          // trnxID: paymentInfo.trnxID,
        };
        const result4Payment = await paymentCollectionBooKeVents.insertOne(
          payment
        );

        res.send({
          status: true,
          message: "Payment done successfully!",
          result4Payment,
        });
      }
    );

    console.log("Successfully connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send(`Hello World! http://localhost:${port}/`);
});

app.listen(port, () => {
  console.log(`Example app listening on port: ${port}`);
});

// asifaowadud
// sof6vxfRNfUEvdCg
