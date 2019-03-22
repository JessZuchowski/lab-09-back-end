'use strict';
//load env variables from .env
require('dotenv').config();
//app dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');
//app setup
const PORT = process.env.PORT || 3000;
const app = express();
//middleware
app.use(cors());

//API ROUTES
// location route, returns location object
// Keys: search_query, formatted_query, latitude and longitude
app.get('/location', getLocation);

// weather route, returns an array of forecast objects
// Keys: forecast, time
app.get('/weather', getWeather);

// TODO: create a getMeetups function
// [ { link:,
// name:,
// creation_date:,
// host:}, ]
// app.get('/meetups', getMeetups);
app.get('/meetups', getMeetups);

// TODO: create a getYelp function
// app.get('/yelp', getYelp);

// '*' route for invalid endpoints
app.use('*', (req, res) => res.send('Sorry, that route does not exist'));

//make sure server is listening for requests
app.listen(PORT, () => console.log(`Listening on PORT ${PORT}`));

//Create the client connection to the database
const client = new pg.Client(process.env.HEROKU_POSTGRESQL_TEAL_URL);
client.connect();
client.on('error', err => console.error(err));

//Error handler for when a 500 error happens
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

// HELPER FUNCTIONS and Data Models

// takes search request and convert to location object
//location refactored for SQL
function getLocation(req, res) {
  let query = req.query.data;

  //defining search query
  let sql = `SELECT * FROM locations WHERE search_query=$1;`
  let values = [query];


  //making query of database
  client.query(sql, values)
    .then(result => {
      //if the location is in the database, return it to the front end
      if (result.rowCount > 0) {
        console.log('LOCATION FROM SQL');
        res.send(result.rows[0]);
      } else {
        //otherwise go get data from APi
        const mapsURL = `https://maps.googleapis.com/maps/api/geocode/json?key=${process.env.GOOGLE_MAPS_API_KEY}&address=${req.query.data}`;
        superagent.get(mapsURL)
          .then(data => {
            console.log('LOCATION FROM API');
            //throw an error if there is a problem with the API
            if (!data.body.results.length) { throw 'No Data' }
            //if there is data:
            else {
              let location = new Location(query, data.body.results[0]);
              //creata a query string to add the location data to SQL
              let newSql = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING id;`;
              let newValues = Object.values(location);
              //insert location data into the database and return the unique id for the new record
              client.query(newSql, newValues)
                .then(result => {
                  //attach the returned id onto the location object
                  location.id = result.rows[0].id;
                  //return the location data to the front end
                  res.send(location);
                })
            }
          })
          .catch(error => handleError(error, res));
      }
    })
}

// function getLocation(req, res) {
//   const mapsURL = `https://maps.googleapis.com/maps/api/geocode/json?key=${process.env.GOOGLE_MAPS_API_KEY}&address=${req.query.data}`;
//   return superagent.get(mapsURL)
//     .then(result => {
//       res.send(new Location(result.body.results[0], req.query.data));
//     })
//     .catch(error => handleError(error));
// }

// returns array of daily forecasts
function getWeather(req, res) {
  const dark_sky_url = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}`;

  return superagent.get(dark_sky_url)
    .then( weatherResult => {
      const weatherSummaries = weatherResult.body.daily.data.map((day) => {
        return new Forecast(day);
      });
      res.send(weatherSummaries);
    })
    .catch(error => handleError(error));
}

// returns array of 20 meetup objects
function getMeetups(req, res) {
  const meetupUrl = `https://api.meetup.com/find/upcoming_events?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&sign=true&key=${process.env.MEETUP_API_KEY}&page=20`;

  return superagent.get(meetupUrl)
    .then( meetupResults => {
      const meetupList = meetupResults.body.events.map((event) => {
        return new MeetupEvent(event);
      });
      res.send(meetupList);
    })
    .catch(error => handleError(error));
}

// Location object constructor
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

// Forecast object constructor
function Forecast(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time*1000).toString().slice(0,15);
}

// Meetup event object constructor
function MeetupEvent(event) {
  this.link = event.link;
  this.name = event.name;
  this.creation_date = new Date(event.time).toString().slice(0, 15);
  this.host = event.group.name;
}