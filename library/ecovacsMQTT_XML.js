const EcovacsMQTT = require('./ecovacsMQTT');
const tools = require('./tools');
const URL = require('url').URL;
const constants = require('./ecovacsConstants');
const https = require('https');
const DOMParser = require('xmldom').DOMParser;
const dictionary = require('./ecovacsConstants_non950type');

class EcovacsMQTT_XML extends EcovacsMQTT {
    constructor(bot, user, hostname, resource, secret, continent, country, vacuum, server_address, server_port = 8883) {
        super(bot, user, hostname, resource, secret, continent, country, vacuum, server_address, server_port);
    }

    sendCommand(action, recipient) {
        let c = this.wrapCommand(action, recipient);
        this.callEcovacsDeviceAPI(c).then((json) => {
            this.handleCommandResponse(action, json);
        }).catch((e) => {
            tools.envLog("[EcovacsMQTT_XML] error sendCommand: %s", e.toString());
        });
    }

    wrapCommand(action, recipient) {
        if (!action) {
            tools.envLog("[EcovacsMQTT_XML] wrapCommand action missing: %s", JSON.stringify(action, getCircularReplacer()));
            return {};
        }
        const auth = {
            'realm': constants.REALM,
            'resource': this.resource,
            'token': this.secret,
            'userid': this.user,
            'with': 'users',
        };
        if (action.name === 'GetLogApiCleanLogs') {
            return {
                'auth': auth,
                "did": recipient,
                "country": this.country,
                "td": "GetCleanLogs",
                "resource": this.vacuum['resource']
            }
        } else {
            return {
                'auth': auth,
                "cmdName": action.name,
                "payload": this.wrapCommand_getPayload(action),
                "payloadType": "x",
                "td": "q",
                "toId": recipient,
                "toRes": this.vacuum['resource'],
                "toType": this.vacuum['class']
            }
        }
    }

    wrapCommand_getPayload(action) {
        let xml = action.to_xml();
        // Remove the td from ctl xml for RestAPI
        let payloadXml = new DOMParser().parseFromString(xml.toString(), 'text/xml');
        payloadXml.documentElement.removeAttribute('td');
        return payloadXml.toString();
    }

    callEcovacsDeviceAPI(params) {
        return new Promise((resolve, reject) => {
            let api = constants.IOTDEVMANAGERAPI;
            if (!params['cmdName']) {
                api = constants.LGLOGAPI;
            } else {
                tools.envLog("[EcovacsMQTT] cmdName: ", params['cmdName']);
            }
            let portalUrlFormat = constants.PORTAL_URL_FORMAT;
            if (this.country.toLowerCase() === 'cn') {
                portalUrlFormat = constants.PORTAL_URL_FORMAT_CN;
            }
            let url = (portalUrlFormat + '/' + api).format({
                continent: this.continent
            });
            let headers = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(params))
            };

            url = new URL(url);
            const reqOptions = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: headers
            };
            tools.envLog("[EcovacsMQTT] Sending POST: ", JSON.stringify(reqOptions, getCircularReplacer()));

            const req = https.request(reqOptions, (res) => {
                res.setEncoding('utf8');
                res.setTimeout(6000);
                let rawData = '';
                res.on('data', (chunk) => {
                    rawData += chunk;
                });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(rawData);
                        if ((json['result'] === 'ok') || (json['ret'] === 'ok')) {
                            if (this.bot.errorCode != "0") {
                                this.bot.handle_error({code: "0"});
                                this.emit("Error", this.bot.errorDescription);
                                this.emit('ErrorCode', this.bot.errorCode);
                            }
                            resolve(json);
                        } else {
                            tools.envLog("[EcovacsMQTT] call failed with %s", JSON.stringify(json, getCircularReplacer()));
                            this.bot.handle_error({code: json['errno']});
                            this.emit("Error", this.bot.errorDescription);
                            this.emit('ErrorCode', this.bot.errorCode);
                            // Error code 3 = request oauth error
                            if (json['errno'] == 3) {
                                this.emit("disconnect", true);
                                this.disconnect();
                            }
                            // Error code 500 = wait for response timed out (see issue #19)
                            if (json['errno'] != 500) {
                                throw "failure code: {errno}".format({
                                    errno: json['errno']
                                });
                            }
                        }
                    } catch (e) {
                        tools.envLog("[EcovacsMQTT] " + e.toString());
                        reject(e);
                    }
                });
            });

            req.on('error', (e) => {
                tools.envLog(`[EcoVacsAPI] problem with request: ${e.message}`);
                reject(e);
            });

            // write data to request body
            req.write(JSON.stringify(params));
            req.end();
        });
    }

    handleCommandResponse(action, json) {
        let result = {};
        if (json.hasOwnProperty('resp')) {
            result = this.command_xml2dict(json['resp'], action);
            this.handleCommand(action.name, result);
        } else if (json.hasOwnProperty('logs')) {
            const children = [];
            for (let i = 0; i < 20; i++) {
                children.push(json.logs[i]);
            }
            result = {
                'event': 'CleanLogs',
                'attrs': {
                    'count': 20
                },
                'children': children
            };
            this.handleCommand(action.name, result);
        } else {
            tools.envLog('[EcovacsMQTT] Unknown response type received: %s', JSON.stringify(json, getCircularReplacer()));
        }
    }

    handleMessage(topic, payload, type = "incoming") {
        let result = this.command_xml2dict(payload);
        this.handleCommand(result['event'], result);
    }

    command_xml2dict(xmlString) {
        const domParser = new DOMParser();
        const xml = domParser.parseFromString(xmlString, "text/xml");
        const firstChild = xml.childNodes[0];
        let attrs = {};
        let event = null;
        tools.envLog('[EcovacsMQTT] xml received: %s', xml);
        if (arguments.length > 1) {
            event = firstChild.tagName;
            const action = arguments[1];
            attrs = action.args
        } else {
            if (!firstChild || !firstChild.attributes) {
                return {
                    'event': 'unknown',
                    'attrs': '',
                    'children': []
                };
            } else {
                event = firstChild.attributes.getNamedItem('td').value;
            }
        }
        let result = {
            'event': event,
            'attrs': attrs,
            'children': []
        };

        for (let i = 0; i < firstChild.attributes.length; i++) {
            result.attrs[firstChild.attributes[i].name] = firstChild.attributes[i].value;
            if (firstChild.childNodes) {
                for (let c = 0; c < firstChild.childNodes.length; c++) {
                    let childObject = {
                        'event': firstChild.childNodes[c].tagName,
                        'attrs': {}
                    };
                    for (let ca = 0; ca < firstChild.childNodes[c].attributes.length; ca++) {
                        childObject['attrs'][firstChild.childNodes[c].attributes[ca].name] = firstChild.childNodes[c].attributes[ca].value;
                    }
                    result.children.push(childObject);
                }
            }
        }
        return result;
    }
}

function getCircularReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
}

module.exports = EcovacsMQTT_XML;
