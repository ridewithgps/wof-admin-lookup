'use strict';

const _ = require('lodash');
const logger = require('pelias-logger').get('wof-pip-service');
const ccToLc = require('./countryCodeToLangCodes.json');
const fs = require('fs');
// cc, id, true/false
try {
  fs.mkdirSync('./temp');
}
catch (error) {
  console.info('Failed to create temp directory!');
}
fs.writeFileSync('./temp/' + process.argv[2]+'.csv', '', {encoding: 'utf-8', flag: 'w'});
/**
 * Return the localized name or default name for the given record
 *
 * @param {object} wofData
 * @returns {false|string}
 */
function getName(wofData) {

  // if this is a US county, use the qs:a2_alt for county
  // eg - wof:name = 'Lancaster' and qs:a2_alt = 'Lancaster County', use latter
  if (isUsCounty(wofData)) {
    return getPropertyValue(wofData, 'qs:a2_alt');
  }

  const result = getLocalizedName(wofData, 'wof:lang_x_spoken') ||
         getLocalizedName(wofData, 'wof:lang_x_official') ||
         getLocalizedName(wofData, 'wof:lang') ||
         getLocalizedNameByCountryCode(wofData);
  const missing = result === false;
  const country = wofData.properties['wof:country'] ? wofData.properties['wof:country'] : '??';
  fs.writeFileSync('./temp/' + process.argv[2]+'.csv', 
                  `${country},${wofData.properties['wof:id']},${missing}\n`,
                   {encoding: 'utf-8', flag: 'a'});

  // attempt to use the following in order of priority and fallback to wof:name if all else fails
  return getLocalizedName(wofData, 'wof:lang_x_spoken') ||
         getLocalizedName(wofData, 'wof:lang_x_official') ||
         getLocalizedName(wofData, 'wof:lang') ||
         getLocalizedNameByCountryCode(wofData) || // fallback to country code to lang code mapping
         getPropertyValue(wofData, 'wof:label') ||
         getPropertyValue(wofData, 'wof:name');
}

// this function is used to verify that a US county QS altname is available
function isUsCounty(wofData) {
  return 'US' === wofData.properties['iso:country'] &&
    'county' === wofData.properties['wof:placetype'] &&
    !_.isUndefined(wofData.properties['qs:a2_alt']);
}

/**
 * Returns the property name of the name to be used
 * according to the language specification
 *
 * example:
 *  if wofData[langProperty] === ['rus']
 *  then return 'name:rus_x_preferred'
 *
 * example with multiple values:
 *  if wofData[langProperty] === ['rus','ukr','eng']
 *  then return 'name:rus_x_preferred'
 *
 * @param {object} wofData
 * @param {Array} languages
 * @returns {string}
 */
function getOfficialLangName(wofData, languages) {

  // convert to array in case it is just a string
  if (!(languages instanceof Array)) {
    languages = [languages];
  }

  if (languages.length > 1) {
    logger.silly(`more than one language specified`, languages,
      wofData.properties['wof:lang_x_official'], languages);
  }

  // for now always just grab the first language in the array
  return `name:${languages[0]}_x_preferred`;
}

/**
 * Given a language property name return the corresponding name:* property if one exists
 * and false if that can't be found for any reason
 *
 * @param {object} wofData
 * @param {string} langProperty
 * @returns {false|string}
 */
function getLocalizedName(wofData, langProperty) {

  // check that there is a value at the specified property and that it's not
  // set to unknown or undefined
  if (wofData.properties.hasOwnProperty(langProperty) &&
    !_.isEmpty(wofData.properties[langProperty]) &&
    wofData.properties[langProperty] !== 'unk' &&
    wofData.properties[langProperty] !== 'und' &&
    !_.isEqual(wofData.properties[langProperty], ['unk']) &&
    !_.isEqual(wofData.properties[langProperty], ['und'])) {

    // build the preferred lang key to use for name, like 'name:deu_x_preferred'
    var official_lang_key = getOfficialLangName(wofData, wofData.properties[langProperty]);

    // check if that language is available
    var name = getPropertyValue(wofData, official_lang_key);
    if (name) {
      return name;
    }

    // if corresponding name property wasn't found, log the error
    logger.warn(langProperty, '[missing]', official_lang_key, wofData.properties['wof:name'],
      wofData.properties['wof:placetype'], wofData.properties['wof:id']);
  }
  return false;
}

/**
 * Given a language property name return the corresponding name:* property if one exists
 * and false if that can't be found for any reason
 *
 * @param {object} wofData
 * @returns {false|string}
 */
function getLocalizedNameByCountryCode(wofData) {
  // check that there is a value at the specified property and that it's not
  // set to unknown or undefined

  logger.warn('Looking up lang by country code', wofData.properties['wof:name'],
  wofData.properties['wof:placetype'], wofData.properties['wof:id']);
  const countryProperty = 'wof:country';
  if (wofData.properties.hasOwnProperty(countryProperty) &&
    !_.isEmpty(wofData.properties[countryProperty]) &&
    wofData.properties[countryProperty] !== 'unk' &&
    wofData.properties[countryProperty] !== 'und' &&
    !_.isEqual(wofData.properties[countryProperty], ['unk']) &&
    !_.isEqual(wofData.properties[countryProperty], ['und'])) {
      let countryCode = wofData.properties[countryProperty];
      if (!ccToLc.hasOwnProperty(countryCode)){
        logger.warn(countryCode, '[missing] in CC2LCMap', wofData.properties['wof:name'],
        wofData.properties['wof:placetype'], wofData.properties['wof:id']);
        return false;
      }
      let officialLangs = ccToLc[countryCode];
      // build the preferred lang key to use for name, like 'name:deu_x_preferred'
      var official_lang_key = getOfficialLangName(wofData, officialLangs);

      // check if that language is available
      var name = getPropertyValue(wofData, official_lang_key);
      if (name) {
        return name;
      }

      // if corresponding name property wasn't found, log the error
      logger.warn(officialLangs, '[missing]', official_lang_key, wofData.properties['wof:name'],
        wofData.properties['wof:placetype'], wofData.properties['wof:id']);
  }
  return false;
}



/**
 * Get the string value of the property or false if not found
 *
 * @param {object} wofData
 * @param {string} property
 * @returns {boolean|string}
 */
function getPropertyValue(wofData, property) {

  if (wofData.properties.hasOwnProperty(property)) {

    // if the value is an array, return the first item
    if (wofData.properties[property] instanceof Array) {
      return wofData.properties[property][0];
    }

    // otherwise just return the value as is
    return wofData.properties[property];
  }
  return false;
}

module.exports = getName;