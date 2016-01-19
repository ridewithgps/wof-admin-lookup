var tape = require('tape');
var event_stream = require('event-stream');
var Document = require('pelias-model').Document;
var _ = require('lodash');

var stream = require('../src/lookupStream');

function test_stream(input, testedStream, callback) {
    var input_stream = event_stream.readArray(input);
    var destination_stream = event_stream.writeArray(callback);

    input_stream.pipe(testedStream).pipe(destination_stream);
}

tape('tests', function(test) {
  test.test('doc without centroid should not modify input', function(t) {
    var input = [
      new Document( 'whosonfirst', 'placetype', '1')
    ];

    var lookupStream = stream.createLookupStream();

    test_stream(input, lookupStream, function(err, actual) {
      t.deepEqual(actual, input, 'nothing should have changed');
      t.end();
    });

  });

  test.test('country, region, county, locality, and neighborhood fields should be set into document', function(t) {
    var input = [
      new Document( 'whosonfirst', 'placetype', '1').setCentroid({ lat: 12.121212, lon: 21.212121 })
    ];

    var expected = [
      new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 12.121212, lon: 21.212121 })
        .setAdmin( 'admin0', 'Country 1')
        .addParent('country', 'Country 1', '1')
        .addParent('country', 'Country 2', '2')
        .setAdmin( 'admin1', 'Region 1')
        .addParent('region', 'Region 1', '3')
        .addParent('region', 'Region 2', '4')
        .setAdmin( 'admin2', 'County 1')
        .addParent('county', 'County 1', '5')
        .addParent('county', 'County 2', '6')
        .setAdmin( 'locality', 'Locality 1')
        .addParent('locality', 'Locality 1', '7')
        .addParent('locality', 'Locality 2', '8')
        .setAdmin( 'local_admin', 'LocalAdmin 1')
        .addParent('localadmin', 'LocalAdmin 1', '9')
        .addParent('localadmin', 'LocalAdmin 2', '10')
        .setAdmin( 'neighborhood', 'Neighbourhood 1')
        .addParent('neighbourhood', 'Neighbourhood 1', '11')
        .addParent('neighbourhood', 'Neighbourhood 2', '12')
    ];

    var resolver = function(centroid, callback) {
      var result = {
        country: [
          { id: 1, name: 'Country 1'},
          { id: 2, name: 'Country 2'}
        ],
        region: [
          { id: 3, name: 'Region 1'},
          { id: 4, name: 'Region 2'}
        ],
        county: [
          { id: 5, name: 'County 1'},
          { id: 6, name: 'County 2'}
        ],
        locality: [
          { id: 7, name: 'Locality 1'},
          { id: 8, name: 'Locality 2'}
        ],
        localadmin: [
          { id: 9, name: 'LocalAdmin 1'},
          { id: 10, name: 'LocalAdmin 2'}
        ],
        neighbourhood: [
          { id: 11, name: 'Neighbourhood 1'},
          { id: 12, name: 'Neighbourhood 2'}
        ]
      };

      setTimeout(callback, 0, null, result);

    };

    var lookupStream = stream.createLookupStream(resolver);

    test_stream(input, lookupStream, function(err, actual) {
      t.deepEqual(actual, expected, 'all fields should have been set');
      t.end();
    });

  });

  test.test('resolver with field-less result should only set fields that are present', function(t) {
    var input = [
      new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 12.121212, lon: 21.212121 }),
      new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 13.131313, lon: 31.313131 })
    ];

    var expected = [
      new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 12.121212, lon: 21.212121 })
        .setAdmin( 'admin1', 'Region')
        .addParent('region', 'Region', '1'),
      new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 13.131313, lon: 31.313131 })
        .setAdmin( 'admin0', 'Country')
        .addParent('country', 'Country', '2')
    ];

    var resolver = function(centroid, callback) {
      if (_.isEqual(centroid, { lat: 12.121212, lon: 21.212121 } )) {
        setTimeout(callback, 0, null, { region: [ { id: 1, name: 'Region' } ] });
      } else if (_.isEqual(centroid, { lat: 13.131313, lon: 31.313131 })) {
        setTimeout(callback, 0, null, { country: [ {id: 2, name: 'Country' } ] });
      }

    };

    var lookupStream = stream.createLookupStream(resolver);

    test_stream(input, lookupStream, function(err, actual) {
      t.deepEqual(actual, expected, 'result with missing fields should not set anything in doc');
      t.end();
    });

  });

  test.test('resolver throwing error should push doc onto stream unmodified', function(t) {
    var input = new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 12.121212, lon: 21.212121 });

    var expected = new Document( 'whosonfirst', 'placetype', '1')
        .setCentroid({ lat: 12.121212, lon: 21.212121 });

    var resolver = function(centroid, callback) {
      setTimeout(callback, 0, 'this is an error', { region: 'Region' } );
    };

    var lookupStream = stream.createLookupStream(resolver);

    var input_stream = event_stream.readArray([input]);
    var destination_stream = event_stream.writeArray(function() {
      t.fail('this stream should not have been called');
      t.end();
    });

    input_stream.pipe(lookupStream).on('error', function(e) {
      t.equal(e, 'this is an error');
      t.deepEqual(input, expected, 'the document should not have been modified');
      t.end();
    }).pipe(destination_stream);

  });

});