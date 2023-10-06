'use strict';

/**
 * A worker processes intended to be launched by the `./index.js` module.
 * Loads one polygon layer into memory, builds a `PolygonLookup` for it, and
 * then returns intersection results for `search` queries.
 */

const logger = require( 'pelias-logger').get('admin-lookup:worker');
const PolygonLookup = require('polygon-lookup');
const v8 = require('v8'); 
const RBush = require('rbush');

const readStream = require('./readStream');
const fs = require('fs');
const path = require('path');

const layer = process.title = process.argv[2];
const datapath = process.argv[3];
const localizedAdminNames = process.argv[4] === 'true';
const startTime = Date.now();

const results = {
  calls: 0,
  hits: 0,
  misses: 0
};

let adminLookup;

process.on('SIGTERM', () => {
  logger.info(`${layer} worker process exiting, stats: ${JSON.stringify(results)}`);
  process.exit(0);
});

const serializedAdminLookupPath = path.join(datapath, 'serialized', `${layer}.v8`); // path to serialized file
if (fs.existsSync(serializedAdminLookupPath)) {
  logger.info(`Found serialized data at ${serializedAdminLookupPath}. Attempting to deserialize...`);
  try {
    const adminDataSer = fs.readFileSync(serializedAdminLookupPath);
    const adminData = v8.deserialize(adminDataSer); // will throw an error of serialization format differs from nodejs version
    const data = adminData.data;
    
    // Create the adminLookup using our deserialized data
    const adminLookupTemp = adminData.adminLookup;
    adminLookup = new PolygonLookup( { features: [] } );
    const rtree = new RBush();
    rtree._maxEntries = adminLookupTemp.rtree._maxEntries;
    rtree._minEntries = adminLookupTemp.rtree._minEntries;
    rtree.data = adminLookupTemp.rtree.data;
    adminLookup.rtree = rtree;
    adminLookup.polygons = adminLookupTemp.polygons;

    process.on('message', msg => {
      switch (msg.type) {
        case 'search' : return handleSearch(msg);
        default       : logger.error('Unknown message:', msg);
      }
    });
    
    // alert the master thread that this worker has been loaded and is ready for requests
    process.send( {
      type: 'loaded',
      layer: layer,
      data: data,
      seconds: ((Date.now() - startTime)/1000)
    });

  } catch (error) {
    logger.warn('Error reading serialization file! Will need to index files from sqlite database.', error);
  }
}
if (adminLookup === undefined)
{
  // could not find/finish deserialization. Will read from sqlite database.
  readStream(datapath, layer, localizedAdminNames, (features) => {
    // find all the properties of all features and write them to a file
    // at the same time, limit the feature.properties to just Id and Hierarchy since it's all that's needed in the worker
    const data = features.reduce((acc, feature) => {
      acc[feature.properties.Id] = feature.properties;
      feature.properties = {
        Id: feature.properties.Id,
        Hierarchy: feature.properties.Hierarchy
      };
      return acc;
    }, {});
    adminLookup = new PolygonLookup( { features: features } );
    // Add serialization of data
    let doSerialization = true;
    if (!fs.existsSync(path.dirname(serializedAdminLookupPath))){
      try {
        fs.mkdirSync(path.dirname(serializedAdminLookupPath));
      } catch (error) {
        if (error.code !== 'EEXIST')
        {
          // multiprocessor application. existsSync may be stale.
          logger.warn(`Error creating ${path.dirname(serializedAdminLookupPath)}, skipping serialization... `);
          doSerialization = false;
        }
      }
    }
    if (doSerialization)
    {
      logger.info(`Serializing data into ${serializedAdminLookupPath}`);
      const adminData = { data: data, adminLookup: adminLookup};
      let adminDataSer = v8.serialize(adminData);
      fs.writeFileSync(serializedAdminLookupPath, adminDataSer);
    }
  
    process.on('message', msg => {
      switch (msg.type) {
        case 'search' : return handleSearch(msg);
        default       : logger.error('Unknown message:', msg);
      }
    });
  
    // alert the master thread that this worker has been loaded and is ready for requests
    process.send( {
      type: 'loaded',
      layer: layer,
      data: data,
      seconds: ((Date.now() - startTime)/1000)
    });
  });

}

function handleSearch(msg) {
  process.send({
    type: 'results',
    layer: layer,
    id: msg.id,
    results: search( msg.coords )
  });
}

/**
 * Search `adminLookup` for `latLon`.
 */
function search( latLon ){
  const poly = adminLookup.search( latLon.longitude, latLon.latitude );

  results.calls++;
  if (poly) {
    results.hits++;
  } else {
    results.misses++;
  }

  return (poly === undefined) ? {} : poly.properties;
}
