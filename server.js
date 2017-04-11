var express     = require('express');
var bodyParser  = require('body-parser')
var app         = express();
var sqlite3     = require("sqlite3").verbose();
var fs          = require("fs");
var dbFile      = "db/background-geolocation.db";

// Init db.
var dbh = initDB(dbFile);

app.disable('etag');
app.use(express.static('.'));
app.use(bodyParser.json());

/**
* GET /devices
*/
app.get('/devices', function(req, res) {
  console.log('GET /devices', "\n");
  Device.all(req.query, function(rs) {
    res.send(rs);
  })
});

app.get('/api/locations', function(req, res) {
  console.log('GET /api/locations');
  res.send({success: true, locations: []});
});

/**
* GET /locations
*/
app.get('/locations', function(req, res) {
  console.log('--------------------------------------------------------------------');
  console.log('- GET /locations', JSON.stringify(req.query));

  Location.all(req.query, function(rs) {
    res.send(rs);
  });
});


/**
* POST /locations
*/
app.post('/locations', function (req, res) {
  console.log('---------------------------------------------------------------------');
  console.log("- POST /locations\n", JSON.stringify(req.body, null, 2), "\n");

  console.log('- headers: ', req.headers);

  var auth = req.get('Authorization');
  console.log('Authorization: ', auth);

  try {
    Location.create(req.body);
  } catch(e) {
    console.log(e.message);
  }
  res.send({success: true});
  //res.status(401).send("Unauthorized");
  //res.status(403).send("Forbidden");
  //res.status(201).send({success: true});
  //res.status(201).send({success: true});
  //res.status(427).send("Too many requests");
  //res.status(500).send("Internal Server Error");
  //res.status(404).send("Not Found");
  //res.status(408).send("Timeout");
});

app.post('/locations_template', function (req, res) {
  console.log('---------------------------------------------------------------------');
  console.log("- POST /locations_template\n", JSON.stringify(req.body, null, 2), "\n");
  res.set('Retry-After', 5);
  res.send({success: true});
  //res.status(401).send("Unauthorized");
});

app.post('/configure', function(req, res) {
  console.log('/configure');

  var response = {
    "access_token":"e7ebae5e-4bea-4d63-8f28-8a104acd2f4c",   
    "token_type":"Bearer",   
    "expires_in":3600,   
    "refresh_token":"2a69e1cd-d7db-44f6-87fc-3d66c4505ee4",   
    "scope":"openid+email+profile+phone+address+group"   
  };

  res.send(response);
});

/**
* Fetch iOS simulator city_drive route
*/
app.get('/data/city_drive', function(req, res) {
  console.log('GET /data/city_drive.json');
  fs.readFile('./data/city_drive.json', 'utf8', function (err,data) {
    res.send(data);
  });
});

var server = app.listen((process.env.PORT || 9000), function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('*************************************************************************');
  console.log('* Background Geolocation Server listening at http://%s:%s', host, port);
  console.log('*************************************************************************', "\n");
});

/**
* Device model
*/
var Device = (function() {
  return {
    all: function(conditions, callback) {
      var query = "SELECT device_id, device_model FROM locations GROUP BY device_id, device_model ORDER BY recorded_at DESC";
      var onQuery = function(err, rows) {
        var rs = [];
        rows.forEach(function (row) {
          rs.push(row);
        });
        callback(rs);
      }
      dbh.all(query, onQuery);
    }
  }
})();
/**
* Location model
*/
var Location = (function() {

  function hydrate(record) {
    if (record.geofence) { record.geofence = JSON.parse(record.geofence); }
    return record;
  }

  return {
    all: function(params, callback) {
      var query = ["SELECT * FROM locations"];
      var conditions = [];
      if (params.start_date && params.end_date) {
        conditions.push("recorded_at BETWEEN ? AND ?")
      }
      if (params.device_id && params.device_id !== '') {
        conditions.push("device_id = ?")
      }
      if (conditions.length) {
        query.push("WHERE " + conditions.join(' AND '));
      }
      query.push("ORDER BY recorded_at DESC");

      console.log('- ', query.join(' '), "\n");
      var onQuery = function(err, rows) {
        if (err) {
          console.log('ERROR: ', err);
          return;
        }
        var rs = [];
        rows.forEach(function (row) {
          rs.push(hydrate(row));
        });
        callback(rs);
      }

      query = query.join(' ');
      if (params.device_id && params.start_date && params.end_date) {
        dbh.all(query, params.start_date, params.end_date, params.device_id, onQuery)
      } else if (params.start_date && params.end_date) {
        dbh.all(query, params.start_date, params.end_date, onQuery);
      } else {
        dbh.all(query, onQuery);
      }
    },
    create: function(params) {
      var location  = params.location,
          now       = new Date(),
          query     = "INSERT INTO locations (uuid, device_id, device_model, latitude, longitude, accuracy, altitude, speed, heading, odometer, event, activity_type, activity_confidence, battery_level, battery_is_charging, is_moving, geofence, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      
      var sth       = dbh.prepare(query);
      
      var insert = function(location) {
        var coords = location.coords,
            battery   = location.battery  || {level: null, is_charging: null},
            activity  = location.activity || {type: null, confidence: null},
            device    = params.device     || {model: "UNKNOWN"};
            geofence  = (location.geofence) ? JSON.stringify(location.geofence) : null;

        var uuid = (device.framework) ? (device.framework + '-' + device.uuid) : device.uuid;
        var model = (device.framework) ?  (device.model + ' (' + device.framework + ')') : device.model;
        sth.run(location.uuid, uuid, model, coords.latitude, coords.longitude, coords.accuracy, coords.altitude, coords.speed, coords.heading, location.odometer, location.event, activity.type, activity.confidence, battery.level, battery.is_charging, location.is_moving, geofence, location.timestamp, now);
      }

      // Check for batchSync, ie: location: {...} OR location: [...]
      if (typeof(location.length) === 'number') {
        // batchSync: true        
        for (var n=0,len=location.length;n<len;n++) {
          insert(location[n]);          
        }
      } else {        
        // batchSync: false
        insert(location);
      }
      sth.finalize();
    }
  }
})();

/**
* Init / create database
*/
function initDB(filename) {
  if(fs.existsSync(filename)) {
    return new sqlite3.Database(filename);
  } else {
    console.log("Creating DB file.");
    fs.mkdir("db", function(e) {
      fs.openSync(filename, "w");
    });
    
    
    var dbh = new sqlite3.Database(filename);  

    var LOCATIONS_COLUMNS = [
      "id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL", 
      "uuid TEXT",
      "device_id TEXT",
      "device_model TEXT",
      "latitude REAL", 
      "longitude REAL",
      "accuracy INTEGER", 
      "altitude REAL",
      "speed REAL",      
      "heading REAL",
      "odometer REAL",
      "event TEXT",
      "activity_type TEXT",
      "activity_confidence INTEGER",
      "battery_level REAL",
      "battery_is_charging BOOLEAN",
      "is_moving BOOLEAN",
      "geofence TEXT",
      "recorded_at DATETIME",
      "created_at DATETIME"
    ];
    dbh.serialize(function() {
      dbh.run("CREATE TABLE locations (" + LOCATIONS_COLUMNS.join(',') + ")");
    });
    return dbh;
  }
}
