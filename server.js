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
const client = new pg.Client(process.env.DATABASE_URL);
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
  console.log('retrieving location');
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
        const mapsURL = `https://maps.googleapis.com/maps/api/geocode/json?address=${req.query.data}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
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
              console.log(newValues);
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

//get the sql data for the requested source
function getData (sqlInfo) {
  let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE location_id = $1;`
  let values = [sqlInfo.id];

  //console.log('getting data', sqlInfo.endpoint);
  try {return client.query(sql, values);}
  catch (error) {handleError(error)}

}
//milliseconds
const timeouts = {
  //15 seconds
  weather: 15 * 1000,
  //24 hours
  yelp: 24 * 1000 * 60 * 60,
  //30 days
  movie: 30 * 1000 * 60 * 60 * 24,
  //6 hours
  meetup: 6 * 1000 * 60 * 60,
  //7 days
  trail: 7 * 1000 * 60 * 60 * 24,
};

//check to see if data is still valid for time period
function checkTimeouts (sqlInfo, sqlData) {
  if (sqlData.rowCount >0) {
    let ageOfResults = (Date.now() - sqlData.rows[0].created_at);
    //console.log(sqlInfo.endpoint, 'age: ', ageOfResults);
    //console.log(sqlInfo.endpoint, 'timeout: ', timeouts[sqlInfo.endpoint]);
    if (ageOfResults >timeouts[sqlInfo.endpoint]) {
      let sql = `DELETE FROM ${sqlInfo.endpoint}s WHERE location_id=$1;`;
      let values = [sqlInfo.id];
      client.query(sql, values)
        .then(() => {
          return null;
        })
        .catch(error => handleError(error));
    } else {return sqlData}
  }
}

//retrieve weather based on location
function getWeather (req, res) {
  //create an object to hold sql query info
  let sqlInfo = {
    id: req.query.data.id,
    endpoint: 'weather',
  }
  getData(sqlInfo)
    .then(data => checkTimeouts(sqlInfo, data))
    .then(result => {
      if (result) {Response.send(result.rows)}
      else {
        const weatherURL = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API_KEY}/${req.query.data.latitude},${req.query.data.longitude}`;

        superagent.get(weatherURL)
          .then(weatherResults => {
            if (!weatherResults.body.daily.data.length) {
              throw 'NO DATA' ;}
            else {
              //process data through constructor to be returned to client
              const weatherSummaries = weatherResults.body.daily.data.map(day => {
                let summary = new Weather(day);
                summary.id = sqlInfo.id;
                //insert into sql database
                let newSql = `INSERT INTO weathers (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4);`;
                let newValues = Object.values(summary);
                client.query(newSql, newValues);
                return summary;
              });
              res.send(weatherSummaries);
            }
          });
      }
    })
    .catch(error => handleError(error));
}

//meetup function refactored

//retrieve meetup based on location
function getMeetups (req, res) {
  //create an object to hold sql query info
  let sqlInfo = {
    id: req.query.data.id,
    endpoint: 'meetup',
  }
  getData(sqlInfo)
    .then(data => checkTimeouts(sqlInfo, data))
    .then(result => {
      if (result) {res.send(result.rows)}
      else {
        const meetupURL = `https://api.meetup.com/find/upcoming_events?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&sign=true&key=${process.env.MEETUP_API_KEY}&page=20`;

        superagent.get(meetupURL)
          .then(meetupResults => {
            if (!meetupResults.body.events.data.length) {
              throw 'NO DATA' ;}
            else {
              //process data through constructor to be returned to client
              const meetupSummaries = meetupResults.body.events.data.map(event => {
                let summary = new MeetupEvent(event);
                summary.id = sqlInfo.id;
                //insert into sql database
                let newSql = `INSERT INTO meetups (link, name, creation_date, host, location_id) VALUES($1, $2, $3, $4, $5);`;
                let newValues = Object.values(summary);
                client.query(newSql, newValues);
                return summary;
              });
              res.send(meetupSummaries);
            }
          });
      }
    })
    .catch(error => handleError(error));
}

// returns array of 20 meetup objects
// function getMeetups(req, res) {
//   const meetupUrl = `https://api.meetup.com/find/upcoming_events?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&sign=true&key=${process.env.MEETUP_API_KEY}&page=20`;

//   return superagent.get(meetupUrl)
//     .then( meetupResults => {
//       const meetupList = meetupResults.body.events.map((event) => {
//         return new MeetupEvent(event);
//       });
//       res.send(meetupList);
//     })
//     .catch(error => handleError(error));
// }

// Location object constructor
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

// Forecast object constructor
function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0,15);
  this.created_at = Date.now();
}

// Meetup event object constructor
function MeetupEvent(event) {
  this.link = event.link;
  this.name = event.name;
  this.creation_date = new Date(event.time).toString().slice(0, 15);
  this.host = event.group.name;
}
