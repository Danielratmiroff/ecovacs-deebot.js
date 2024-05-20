"use strict";

const ecovacsDeebot = require("./index");
const tools = require("./example/tools");
const EcoVacsAPI = ecovacsDeebot.EcoVacsAPI;
const nodeMachineId = require("node-machine-id");

let settingsFile = tools.getSettingsFile();

const accountId = settingsFile.ACCOUNT_ID;
const password = settingsFile.PASSWORD;
const countryCode = settingsFile.COUNTRY_CODE;
const deviceNumber = settingsFile.DEVICE_NUMBER;
const domain = settingsFile.AUTH_DOMAIN ? settingsFile.AUTH_DOMAIN : "";

// The passwordHash is a md5 hash of your Ecovacs password.
const passwordHash = EcoVacsAPI.md5(password);
// You need to provide a device ID uniquely identifying the machine you're using to connect
const deviceId = EcoVacsAPI.getDeviceId(nodeMachineId.machineIdSync(), deviceNumber);

const api = new EcoVacsAPI(deviceId, countryCode, "", domain);

// This logs you in through the HTTP API and retrieves the required
// access tokens from the server side. This allows you to requests
// the devices linked to your account to prepare connectivity to your vacuum.
api
  .connect(accountId, passwordHash)
  .then(() => {
    api.devices().then((devices) => {
      api.logInfo(`Devices: ${JSON.stringify(devices)}`);

      let vacuum = devices[deviceNumber];
      let vacbot = api.getVacBot(api.uid, EcoVacsAPI.REALM, api.resource, api.user_access_token, vacuum, api.getContinent());

      // Once the session has started the bot will fire a "ready" event.
      // At this point you can request information from your vacuum or send actions to it.
      vacbot.on("ready", () => {
        api.logInfo("vacbot ready");

        // Trigger the GetMaps command to get the map data object
        const createMapDataObject = true;
        const createMapImage = false;
        vacbot.run("GetMaps", createMapDataObject, createMapImage);

        // Listen for the MapDataObject event and extract spot areas
        vacbot.on("MapDataObject", (mapDataObject) => {
          let mapData = Object.assign(mapDataObject[0]);
          let spotAreaNames = mapData.mapSpotAreas.map((area) => area.mapSpotAreaName);

          api.logInfo(`Spot area names: ${JSON.stringify(spotAreaNames)}`);

          // Filter out the kitchen area from spot areas
          const KITCHEN_AREA_NAME = "Kitchen1";

          if (spotAreaNames.includes(KITCHEN_AREA_NAME)) {
            let cleanableSpotAreaIds = mapData.mapSpotAreas
              .filter((area) => area.mapSpotAreaName !== KITCHEN_AREA_NAME)
              .map((area) => area.mapSpotAreaID);

            vacbot.run("SetCleanSpeed", 2); // Power adjustment - value range 1-4
            vacbot.run("SetWaterLevel", 1); // Water level adjustment - value range 1-4
            vacbot.run("SetCleanCount", 1); // Cleaning cycles - value range 1-2

            api.logInfo(`Cleanable spot area IDs: ${JSON.stringify(cleanableSpotAreaIds)}`);

            // Clean the areas
            vacbot.spotArea(cleanableSpotAreaIds);
          } else {
            api.logInfo("No spot area with name 'Kitchen1' found.");
          }
        });
      });

      vacbot.connect();

      //
      // Catch ctrl-c to exit program
      //
      process.on("SIGINT", function () {
        api.logInfo("\nGracefully shutting down from SIGINT (Ctrl+C)");
        disconnect();
      });

      function disconnect() {
        (async () => {
          try {
            await vacbot.disconnectAsync();
            api.logEvent("Exiting...");
            process.exit();
          } catch (e) {
            api.logError("Failure in disconnecting: ", e.message);
          }
        })();
      }
    });
  })
  .catch((e) => {
    console.error(`Failure in connecting: ${e.message}`);
  });
