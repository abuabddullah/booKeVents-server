require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());

// JWT token generation
function generateToken(userInfo) {
  const token = jwt.sign(
    {
      email: userInfo.email,
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
  req.user = verify.email;

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
      // 1-add user to attendees array
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const event = await eventsCollection4BooKeVents.findOne(query);
      const attendeesArray = event.attendees;

      // 1.2 - if user has already booked this event then return a message
      const isUserBooked = attendeesArray.find(
        (attendee) => attendee.email === req.user
      );
      if (isUserBooked) {
        return res.send({
          status: "Booking failed",
          message: "You have already booked this event!",
        });
      }

      const newAttendee = { email: req.user, isPaid: false, trnxID: "" };
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
          status: "Booking failed",
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
        status: "Booking success",
        message: "Event booked successfully!",
      });
    });
    // get my events based on email
    app.get("/api/v1/my-events", verifyToken, async (req, res) => {
      const email = req.user;
      const cursor4AllEventsData = eventsCollection4BooKeVents.find({});
      const resutl4allEventsArray = await cursor4AllEventsData.toArray();

      // get all events booked by the user based on email
      const myEvents = [];
      resutl4allEventsArray.forEach((event) => {
        const attendeesArray = event.attendees;
        const isUserBooked = attendeesArray.find(
          (attendee) => attendee.email === email
        );
        if (isUserBooked) {
          myEvents.push(event);
        }
      });

      res.send(myEvents);
    });

    // patch payment for an event

    const paymentCollectionBooKeVents = booKeVentsDB.collection(
      "paymentCollectionBooKeVents"
    );
    app.patch("/api/v1/events/pay-event/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const paymentInfo = req.body;
      // 1-update isPaid to true and add trnxID to the attendee of an event
      const query = { _id: new ObjectId(id) };
      const event = await eventsCollection4BooKeVents.findOne(query);

      const attendeesArray = event.attendees;
      const attendeeIndex = attendeesArray.findIndex(
        (attendee) => attendee.email === req.user
      );
      attendeesArray[attendeeIndex].isPaid = true;
      attendeesArray[attendeeIndex].trnxID = paymentInfo.trnxID;

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
      const eventsArray = user.events;
      const eventIndex = eventsArray.findIndex(
        (event) => event?.eventID === id
      );
      eventsArray[eventIndex].isPaid = true;
      eventsArray[eventIndex].trnxID = paymentInfo.trnxID;
      const userUpdate = {
        $set: {
          events: eventsArray,
        },
      };
      const result4UpdateUsersColl =
        await usersCollection4booKeVentsDB.updateOne(userQuery, userUpdate);

      //3 - post payment to payment collection
      const payment = {
        email: req.user,
        eventID: id,
        trnxID: paymentInfo.trnxID,
      };
      const result4Payment = await paymentCollectionBooKeVents.insertOne(
        payment
      );

      res.send({
        status: "Payment success",
        message: "Payment done successfully!",
        result4Payment,
      });
    });

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
