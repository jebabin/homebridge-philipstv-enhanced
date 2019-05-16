var Service;
var Characteristic;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var wol = require('wake_on_lan');
var MenuItem = require('./menuitem');

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-philipstv-enhanced-x", "PhilipsTV", HttpStatusAccessory);
}

function HttpStatusAccessory(log, config) {
    this.log = log;
    var that = this;

    // CONFIG
    this.ip_address = config["ip_address"];
    this.name = config["name"];
    this.poll_status_interval = config["poll_status_interval"] || "0";
    this.model_year = config["model_year"] || "2018";
    this.wol_url = config["wol_url"] || "";
    this.model_year_nr = parseInt(this.model_year);
    this.set_attempt = 0;
    this.has_ambilight = config["has_ambilight"] || false;
    this.has_ssl = config["has_ssl"] || false;

    // CREDENTIALS FOR API
    this.username = config["username"] || "";
    this.password = config["password"] || "";

    // CHOOSING API VERSION BY MODEL/YEAR
    switch (this.model_year_nr) {
        case 2018:
            this.api_version = 6;
            break;
        case 2017:
            this.api_version = 6;
            break;
        case 2016:
            this.api_version = 6;
            break;
        case 2015:
            this.api_version = 5;
            break;
        case 2014:
            this.api_version = 5;
            break;
        default:
            this.api_version = 1;
    }

    // CONNECTION SETTINGS
    this.protocol = this.has_ssl ? "https" : "http";
    this.portno = this.has_ssl ? "1926" : "1925";
    this.need_authentication = this.username != '' ? 1 : 0;

    this.log("Model year: " + this.model_year_nr);
    this.log("API version: " + this.api_version);

    this.state_power = true;
    this.state_ambilight = false;
    this.state_ambilightLevel = 0;
    this.state_volume = false;
    this.state_volumeLevel = 0;

    // Define URL & JSON Payload for Actions

    this.base_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version;

    // POWER
    this.power_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/powerstate";
    this.power_on_body = JSON.stringify({
        "powerstate": "On"
    });
    this.power_off_body = JSON.stringify({
        "powerstate": "Standby"
    });

    // Volume
    this.audio_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/audio/volume";
    this.audio_unmute_body = JSON.stringify({
        "muted": false
    });
    this.audio_mute_body = JSON.stringify({
        "muted": true
    });

    // INPUT
    this.input_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/input/key";

    // AMBILIGHT
    this.ambilight_brightness = new MenuItem(this, this.log, 2131230842, false);
    //this.log("Setting up brightness: ", this.ambilight_brightness);

    this.ambilight_status_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/menuitems/settings/current";
	this.ambilight_brightness_body = JSON.stringify({"nodes":[{"nodeid":2131230769}]});
	this.ambilight_mode_body = JSON.stringify({"nodes":[{"nodeid":100}]});
	
    this.ambilight_config_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/menuitems/settings/update";
    this.ambilight_power_on_body = JSON.stringify({"value":{"Nodeid":100,"Controllable":true,"Available":true,"data":{"activenode_id":120}}}); // Follow Video 
    this.ambilight_power_off_body = JSON.stringify({"value":{"Nodeid":100,"Controllable":true,"Available":true,"data":{"activenode_id":110}}}); // Off

    // POLLING ENABLED?
    this.interval = parseInt(this.poll_status_interval);
    this.switchHandling = "check";
    if (this.interval > 10 && this.interval < 100000) {
        this.switchHandling = "poll";
    }

    // STATUS POLLING
    if (this.switchHandling == "poll") {
        var statusemitter = pollingtoevent(function(done) {
            that.getPowerState(function(error, response) {
                done(error, response, that.set_attempt);
            }, "statuspoll");
        }, {
            longpolling: true,
            interval: that.interval * 1000,
            longpollEventName: "statuspoll_power"
        });

        statusemitter.on("statuspoll_power", function(data) {
            that.state_power = data;
            if (that.switchService) {
                that.switchService.getCharacteristic(Characteristic.On).setValue(that.state_power, null, "statuspoll");
            }
        });

        var statusemitter_volume = pollingtoevent(function(done) {
            that.getVolumeState(function(error, response) {
                done(error, response, that.set_attempt);
            }, "statuspoll");
        }, {
            longpolling: true,
            interval: that.interval * 1000,
            longpollEventName: "statuspoll_volume"
        });

        statusemitter.on("statuspoll_volume", function(data) {
            that.state_volume = data;
            if (that.VolumeService) {
                that.VolumeService.getCharacteristic(Characteristic.On).setValue(that.state_volume, null, "statuspoll");
            }
        });

        var statusemitter_volume_level = pollingtoevent(function(done) {
            that.getVolumeLevel(function(error, response) {
                done(error, response, that.set_attempt);
            }, "statuspoll");
        }, {
            longpolling: true,
            interval: that.interval * 1000,
            longpollEventName: "statuspoll_volumeLevel"
        });

        statusemitter.on("statuspoll_volumeLevel", function(data) {
            that.state_volumeLevel = data;
            if (that.VolumeService) {
                that.VolumeService.getCharacteristic(Characteristic.Brightness).setValue(that.state_volumeLevel, null, "statuspoll");
            }
        });

        if (this.has_ambilight) {
            var statusemitter_ambilight = pollingtoevent(function(done) {
                that.getAmbilightState(function(error, response) {
                    done(error, response, that.set_attempt);
                }, "statuspoll");
            }, {
                longpolling: true,
                interval: that.interval * 1000,
                longpollEventName: "statuspoll_ambilight"
            });

            statusemitter_ambilight.on("statuspoll_ambilight", function(data) {
                that.state_ambilight = data;
                if (that.ambilightService) {
                    that.ambilightService.getCharacteristic(Characteristic.On).setValue(that.state_ambilight, null, "statuspoll");
                }
            });
            
            var statusemitter_ambilight_brightness = pollingtoevent(function(done) {
                that.getAmbilightBrightness(function(error, response) {
                    done(error, response, that.set_attempt);
                }, "statuspoll");
            }, {
                longpolling: true,
                interval: that.interval * 1000,
                longpollEventName: "statuspoll_ambilight_brightness"
            });

            statusemitter_ambilight_brightness.on("statuspoll_ambilight_brightness", function(data) {
                that.state_ambilight_brightness = data;
                if (that.ambilightService) {
                    that.ambilightService.getCharacteristic(Characteristic.Brightness).setValue(that.state_ambilight_brightness, null, "statuspoll");
                }
            });            
            
            
        }
    }
}

/////////////////////////////

HttpStatusAccessory.prototype = {

	// Sometime the API fail, all calls should use a retry method, not used yet but goal is to replace all the XLoop function by this generic one
    httpRequest_with_retry: function(url, body, method, need_authentication, retry_count, callback) {
        this.httpRequest(url, body, method, need_authentication, function(error, response, responseBody) {
            if (error) {
                if (retry_count > 0) {
                    this.log('Got error, will retry: ', retry_count, ' time(s)');
                    this.httpRequest_with_retry(url, body, method, need_authentication, retry_count - 1, function(err) {
                        callback(err);
                    });
                } else {
                    this.log('Request failed: %s', error.message);
                    callback(new Error("Request attempt failed"));
                }
            } else {
                this.log('succeeded - answer: %s', responseBody);
                callback(null, response, responseBody);
            }
        }.bind(this));
    },

    httpRequest: function(url, body, method, need_authentication, callback) {
        var options = {
            url: url,
            body: body,
            method: method,
            rejectUnauthorized: false,
            timeout: 3000
        };

        // EXTRA CONNECTION SETTINGS FOR API V6 (HTTP DIGEST)
        if (need_authentication) {
            options.followAllRedirects = true;
            options.forever = true;
            options.auth = {
                user: this.username,
                pass: this.password,
                sendImmediately: false
            }
        }
        
        req = request(options,
            function(error, response, body) {
                callback(error, response, body)
        	}
        );
    },

    pathRequest: function(path, body, method, callback) {
        this.httpRequest(this.base_url + path, body, method, true, callback);
    },

    wolRequest: function(url, callback) {
        this.log('calling WOL with URL %s', url);
        if (!url) {
            callback(null, "EMPTY");
            return;
        }
        if (url.substring(0, 3).toUpperCase() == "WOL") {
            //Wake on lan request
            var macAddress = url.replace(/^WOL[:]?[\/]?[\/]?/ig, "");
            this.log("Excuting WakeOnLan request to " + macAddress);
            wol.wake(macAddress, function(error) {
                if (error) {
                    callback(error);
                } else {
                    callback(null, "OK");
                }
            });
        } else {
            if (url.length > 3) {
                callback(new Error("Unsupported protocol: ", "ERROR"));
            } else {
                callback(null, "EMPTY");
            }
        }
    },

    // POWER FUNCTIONS
    setPowerStateLoop: function(nCount, url, body, powerState, callback) {
        var that = this;

        that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                if (nCount > 0) {
                    that.log('setPowerStateLoop - powerstate attempt, attempt id: ', nCount - 1);
                    that.setPowerStateLoop(nCount - 1, url, body, powerState, function(err, state_power) {
                        callback(err, state_power);
                    });
                } else {
                    that.log('setPowerStateLoop - failed: %s', error.message);
                    powerState = false;
                    callback(new Error("HTTP attempt failed"), powerState);
                }
            } else {
                that.log('setPowerStateLoop - Succeeded - current state: %s', powerState);
                callback(null, powerState);
            }
        });
    },

    setPowerState: function(powerState, callback, context) {
        var url = this.power_url;
        var body;
        var that = this;

		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, powerState);

        if (context && context == "statuspoll") {
				callback(null, powerState);
				return;
        }

        this.set_attempt = this.set_attempt + 1;

        if (powerState) {
            if (this.model_year_nr <= 2013) {
                this.log("Power On is not possible for model_year before 2014.");
                callback(new Error("Power On is not possible for model_year before 2014."));
            }
            body = this.power_on_body;
            this.log("setPowerState - Will power on");
			// If Mac Addr for WOL is set
			if (this.wol_url) {
				that.log('setPowerState - Sending WOL');
				this.wolRequest(this.wol_url, function(error, response) {
					that.log('setPowerState - WOL callback response: %s', response);
					that.log('setPowerState - powerstate attempt, attempt id: ', 8);
					//execute the callback immediately, to give control back to homekit
					callback(error, that.state_power);
					that.setPowerStateLoop(8, url, body, powerState, function(error, state_power) {
						that.state_power = state_power;
						if (error) {
							that.state_power = false;
							that.log("setPowerStateLoop - ERROR: %s", error);
							if (that.switchService) {
								that.switchService.getCharacteristic(Characteristic.On).setValue(that.state_power, null, "statuspoll");
							}
						}
					});
				}.bind(this));
			} 
        } else {
            body = this.power_off_body;
            this.log("setPowerState - Will power off");
            that.setPowerStateLoop(0, url, body, powerState, function(error, state_power) {
                that.state_power = state_power;
                if (error) {
                    that.state_power = false;
                    that.log("setPowerStateLoop - ERROR: %s", error);
                }
                if (that.switchService) {
                    that.switchService.getCharacteristic(Characteristic.On).setValue(that.state_power, null, "statuspoll");
                }
                if (that.ambilightService) {
                    that.state_ambilight = false;
                    that.ambilightService.getCharacteristic(Characteristic.On).setValue(that.state_ambilight, null, "statuspoll");
                }
                 if (that.volumeService) {
                    that.state_volume = false;
                    that.volumeService.getCharacteristic(Characteristic.On).setValue(that.state_volume, null, "statuspoll");
                }
                callback(error, that.state_power);
            }.bind(this));
        }
    },

    getPowerState: function(callback, context) {
        var that = this;
        var url = this.power_url;
        
        
   		this.log.debug("Entering %s with context: %s and current value: %s", arguments.callee.name, context, this.state_power);
        //if context is statuspoll, then we need to request the actual value else we return the cached value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
            callback(null, this.state_power);
            return;
        }

        this.httpRequest(url, "", "GET", this.need_authentication, function(error, response, responseBody) {
            var tResp = that.state_power;
            var fctname = "getPowerState";
            if (error) {
                that.log('%s - ERROR: %s', fctname, error.message);
                that.state_power = false;
            } else {
                if (responseBody) {
                    var responseBodyParsed;
                    try {
                        responseBodyParsed = JSON.parse(responseBody);
                        if (responseBodyParsed && responseBodyParsed.powerstate) {
                        	tResp = (responseBodyParsed.powerstate == "On") ? 1 : 0;
						} else {
		                    that.log("%s - Could not parse message: '%s', not updating state", fctname, responseBody);
						}
                    } catch (e) {
                        that.log("%s - Got non JSON answer - not updating state: '%s'", fctname, responseBody);
                    }
                }
                if (that.state_power != tResp) {
                    that.log('%s - Level changed to: %s', fctname, tResp);
	                that.state_power = tResp;
                }
            }
            callback(null, that.state_power);
        }.bind(this));
    },

    // AMBILIGHT FUNCTIONS
    setAmbilightStateLoop: function(nCount, url, body, ambilightState, callback) {
        var that = this;

        that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                if (nCount > 0) {
                    that.log('setAmbilightStateLoop - attempt, attempt id: ', nCount - 1);
                    that.setAmbilightStateLoop(nCount - 1, url, body, ambilightState, function(err, state) {
                        callback(err, state);
                    });
                } else {
                    that.log('setAmbilightStateLoop - failed: %s', error.message);
                    ambilightState = false;
                    callback(new Error("HTTP attempt failed"), ambilightState);
                }
            } else {
                that.log('setAmbilightStateLoop - succeeded - current state: %s', ambilightState);
                callback(null, ambilightState);
            }
        });
    },

    setAmbilightState: function(ambilightState, callback, context) {
		this.log.debug("Entering setAmbilightState with context: %s and requested value: %s", context, ambilightState);
        var url;
        var body;
        var that = this;

        //if context is statuspoll, then we need to ensure that we do not set the actual value
        if (context && context == "statuspoll") {
            callback(null, ambilightState);
            return;
        }

        this.set_attempt = this.set_attempt + 1;

        if (ambilightState) {
            url = this.ambilight_config_url;
            body = this.ambilight_power_on_body;
            this.log("setAmbilightState - setting state to on");
        } else {
            url = this.ambilight_config_url;
            body = this.ambilight_power_off_body;
            this.log("setAmbilightState - setting state to off");
        }

        that.setAmbilightStateLoop(0, url, body, ambilightState, function(error, state) {
            that.state_ambilight = ambilightState;
            if (error) {
                that.state_ambilight = false;
                that.log("setAmbilightState - ERROR: %s", error);
                if (that.ambilightService) {
                    that.ambilightService.getCharacteristic(Characteristic.On).setValue(that.state_ambilight, null, "statuspoll");
                }
            }
            callback(error, that.state_ambilight);
        }.bind(this));
    },

    getAmbilightState: function(callback, context) {
        var that = this;
        var url = this.ambilight_status_url;
        var body = this.ambilight_mode_body;

		this.log.debug("Entering %s with context: %s and current value: %s", arguments.callee.name, context, this.state_ambilight);
        //if context is statuspoll, then we need to request the actual value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
            callback(null, this.state_ambilight);
            return;
        }
        if (!this.state_power) {
                callback(null, false);
                return;
        }

        this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            var tResp = that.state_ambilight;
            var fctname = "getAmbilightState";
            if (error) {
                that.log('%s - ERROR: %s', fctname, error.message);
            } else {
                if (responseBody) {
	                var responseBodyParsed;
                    try {
						responseBodyParsed = JSON.parse(responseBody);
						if (responseBodyParsed && responseBodyParsed.values[0].value.data.activenode_id) {
							tResp = (responseBodyParsed.values[0].value.data.activenode_id == 110) ? false : true;
							that.log.debug('%s - got answer %s', fctname, tResp);
						} else {
		                    that.log("%s - Could not parse message: '%s', not updating state", fctname, responseBody);
						}
					} catch (e) {
                        that.log("%s - Got non JSON answer - not updating state: '%s'", fctname, responseBody);
                    }
                }
                if (that.state_ambilight != tResp) {
                    that.log('%s - state changed to: %s', fctname, tResp);
	                that.state_ambilight = tResp;
                }
            }
            callback(null, that.state_ambilight);
        }.bind(this));
    },

    setAmbilightBrightnessLoop: function(nCount, url, body, ambilightLevel, callback) {
        var that = this;

        that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                if (nCount > 0) {
                    that.log('setAmbilightStateLoop - attempt, attempt id: ', nCount - 1);
                    that.setAmbilightBrightnessLoop(nCount - 1, url, body, ambilightLevel, function(err, state) {
                        callback(err, state);
                    });
                } else {
                    that.log('setAmbilightBrightnessLoop - failed: %s', error.message);
                    ambilightLevel = false;
                    callback(new Error("HTTP attempt failed"), ambilightLevel);
                }
            } else {
                that.log('setAmbilightBrightnessLoop - succeeded - current state: %s', ambilightLevel);
                callback(null, ambilightLevel);
            }
        });
    },

    setAmbilightBrightness: function(ambilightLevel, callback, context) {
		var TV_Adjusted_ambilightLevel = Math.round(ambilightLevel / 10);
        var url = this.ambilight_config_url;
        var body = JSON.stringify({"value":{"Nodeid":200,"Controllable":true,"Available":true,"data":{"value":TV_Adjusted_ambilightLevel}}});
        var that = this;

 		this.log.debug("Entering setAmbilightBrightness with context: %s and requested value: %s", context, ambilightLevel);
        //if context is statuspoll, then we need to ensure that we do not set the actual value
        if (context && context == "statuspoll") {
            callback(null, ambilightLevel);
            return;
        }

        this.set_attempt = this.set_attempt + 1;

        that.setAmbilightBrightnessLoop(0, url, body, ambilightLevel, function(error, state) {
            that.state_ambilightLevel = ambilightLevel;
            if (error) {
                that.state_ambilightLevel = false;
                that.log("setAmbilightBrightness - ERROR: %s", error);
                if (that.ambilightService) {
                    that.ambilightService.getCharacteristic(Characteristic.On).setValue(that.state_ambilightLevel, null, "statuspoll");
                }
            }
            callback(error, that.state_ambilightLevel);
        }.bind(this));
    },

    getAmbilightBrightness: function(callback, context) {
        var that = this;
        var url = this.ambilight_status_url;
        var body = this.ambilight_brightness_body;

		this.log.debug("Entering %s with context: %s and current value: %s", arguments.callee.name, context, this.state_ambilightLevel);
        //if context is statuspoll, then we need to request the actual value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
            callback(null, this.state_ambilightLevel);
            return;
        }
        if (!this.state_power) {
                callback(null, 0);
                return;
        }

        this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            var tResp = that.state_ambilightLevel;
            var fctname = "getAmbilightBrightness";
            if (error) {
                that.log('%s - ERROR: %s', fctname, error.message);
            } else {
                if (responseBody) {
	                var responseBodyParsed;
                    try {
						responseBodyParsed = JSON.parse(responseBody);
						if (responseBodyParsed && responseBodyParsed.values[0].value.data) {
							tResp = 10*responseBodyParsed.values[0].value.data.value;
							that.log.debug('%s - got answer %s', fctname, tResp);
						} else {
		                    that.log("%s - Could not parse message: '%s', not updating level", fctname, responseBody);
						}
					} catch (e) {
                        that.log("%s - Got non JSON answer - not updating level: '%s'", fctname, responseBody);
                    }
                }
                if (that.state_ambilightLevel != tResp) {
                    that.log('%s - Level changed to: %s', fctname, tResp);
	                that.state_ambilightLevel = tResp;
                }
            }
            callback(null, that.state_ambilightLevel);
        }.bind(this));
    },

    // Volume

    setVolumeStateLoop: function(nCount, url, body, volumeState, callback) {
        var that = this;

        that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                if (nCount > 0) {
                    that.log('setVolumeStateLoop - attempt, attempt id: ', nCount - 1);
                    that.setVolumeStateLoop(nCount - 1, url, body, volumeState, function(err, state) {
                        callback(err, state);
                    });
                } else {
                    that.log('setVolumeStateLoop - failed: %s', error.message);
                    volumeState = false;
                    callback(new Error("HTTP attempt failed"), volumeState);
                }
            } else {
                that.log('setVolumeStateLoop - succeeded - current state: %s', volumeState);
                callback(null, volumeState);
            }
        });
    },

    setVolumeState: function(volumeState, callback, context) {
        var url = this.audio_url;
        var body;
        var that = this;

		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, volumeState);

        //if context is statuspoll, then we need to ensure that we do not set the actual value
        if (context && context == "statuspoll") {
            callback(null, volumeState);
            return;
        }

        this.set_attempt = this.set_attempt + 1;

        if (volumeState) {
            body = this.audio_unmute_body;
            this.log("setVolumeState - setting state to on");
        } else {
            body = this.audio_mute_body;
            this.log("setVolumeState - setting state to off");
        }

        that.setVolumeStateLoop(0, url, body, volumeState, function(error, state) {
            that.state_volume = volumeState;
            if (error) {
                that.state_volume = false;
                that.log("setVolumeState - ERROR: %s", error);
                if (that.volumeService) {
                    that.volumeService.getCharacteristic(Characteristic.On).setValue(that.state_volume, null, "statuspoll");
                }
            }
            callback(error, that.state_volume);

        }.bind(this));
    },

    setVolumeLevelLoop: function(nCount, url, body, volumeLevel, callback) {
        var that = this;

        that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                if (nCount > 0) {
                    that.log('setVolumeLevelLoop - attempt, attempt id: ', nCount - 1);
                    that.setVolumeLevelLoop(nCount - 1, url, body, volumeLevel, function(err, state) {
                        callback(err, state);
                    });
                } else {
                    that.log('setVolumeLevelLoop - failed: %s', error.message);
                    volumeLevel = false;
                    callback(new Error("HTTP attempt failed"), volumeLevel);
                }
            } else {
                that.log('setVolumeLevelLoop - succeeded - current level: %s', volumeLevel);
                callback(null, volumeLevel);
            }
        });
    },

    setVolumeLevel: function(volumeLevel, callback, context) {
        var TV_Adjusted_volumeLevel = Math.round(volumeLevel / 4);
        var url = this.audio_url;
        var body = JSON.stringify({"current": TV_Adjusted_volumeLevel});
        var that = this;

		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, volumeLevel);

        //if context is statuspoll, then we need to ensure that we do not set the actual value
        if (context && context == "statuspoll") {
            callback(null, volumeLevel);
            return;
        }

        this.set_attempt = this.set_attempt + 1;

        // volumeLevel will be in %, let's convert to reasonable values accepted by TV
        that.setVolumeLevelLoop(0, url, body, volumeLevel, function(error, state) {
            that.state_volumeLevel = volumeLevel;
            if (error) {
                that.state_volumeLevel = false;
                that.log("setVolumeState - ERROR: %s", error);
                if (that.volumeService) {
                    that.volumeService.getCharacteristic(Characteristic.On).setValue(that.state_volumeLevel, null, "statuspoll");
                }
            }
            callback(error, that.state_volumeLevel);
        }.bind(this));
    },

    getVolumeState: function(callback, context) {
        var that = this;
        var url = this.audio_url;

   		this.log.debug("Entering %s with context: %s and current state: %s", arguments.callee.name, context, this.state_volume);

        //if context is statuspoll, then we need to request the actual value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
            callback(null, this.state_volume);
            return;
        }
        if (!this.state_power) {
                callback(null, false);
                return;
        }
        
        this.httpRequest(url, "", "GET", this.need_authentication, function(error, response, responseBody) {
            var tResp = that.state_volume;
            var fctname = "getVolumeState";
            if (error) {
                that.log('%s - ERROR: %s', fctname, error.message);
            } else {
                if (responseBody) {
                	var responseBodyParsed;
                    try {
						responseBodyParsed = JSON.parse(responseBody);
						if (responseBodyParsed) {
							tResp = (responseBodyParsed.muted == "true") ? 0 : 1;
							that.log.debug('%s - got answer %s', fctname, tResp);
						} else {
		                    that.log("%s - Could not parse message: '%s', not updating state", fctname, responseBody);
						}
					} catch (e) {
                        that.log("%s - Got non JSON answer - not updating state: '%s'", fctname, responseBody);
                    }
                }
                if (that.state_volume != tResp) {
                    that.log('%s - state changed to: %s', fctname, tResp);
	                that.state_volume = tResp;
                }
            }
            callback(null, tResp);
        }.bind(this));
    },

    getVolumeLevel: function(callback, context) {
        var that = this;
        var url = this.audio_url;

   		this.log.debug("Entering %s with context: %s and current value: %s", arguments.callee.name, context, this.state_volumeLevel);
        //if context is statuspoll, then we need to request the actual value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
            callback(null, this.state_volumeLevel);
            return;
        }
        if (!this.state_power) {
                callback(null, 0);
                return;
        }

        this.httpRequest(url, "", "GET", this.need_authentication, function(error, response, responseBody) {
            var tResp = that.state_volumeLevel;
            var fctname = "getVolumeLevel";
            if (error) {
                that.log('%s - ERROR: %s', fctname, error.message);
            } else {
                if (responseBody) {
                    var responseBodyParsed;
                    try {
						responseBodyParsed = JSON.parse(responseBody);
						if (responseBodyParsed) {
							tResp = Math.round(4 * responseBodyParsed.current);
							that.log.debug('%s - got answer %s', fctname, tResp);
						} else {
		                    that.log("%s - Could not parse message: '%s', not updating level", fctname, responseBody);
						}
					 } catch (e) {
                        that.log("%s - Got non JSON answer - not updating level: '%s'", fctname, responseBody);
                    }
                }
				if (that.state_volumeLevel != tResp) {
                    that.log('%s - Level changed to: %s', fctname, tResp);
	                that.state_volumeLevel = tResp;
				}
            }
            callback(null, that.state_volumeLevel);
        }.bind(this));
    },

    /// Next input
    setNextInput: function(inputState, callback, context) {
        this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, inputState);

        url = this.input_url;
        body = JSON.stringify({"key": "Source"});
        this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                this.log('setNextInput - error: ', error.message);
            } else {
                	this.log('Source - succeeded - current state: %s', inputState);

					setTimeout(function () {
					body = JSON.stringify({"key": "CursorDown"});

					this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
						if (error) {
           				     this.log('setNextInput - error: ', error.message);
						} else {
								this.log('Down - succeeded - current state: %s', inputState);
								setTimeout(function () {
								body = JSON.stringify({"key": "CursorRight"});

								this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
									if (error) {
               							 this.log('setNextInput - error: ', error.message);
									} else {
											this.log('Right - succeeded - current state: %s', inputState);
											setTimeout(function() {
												body = JSON.stringify({"key": "Confirm"});

												this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
													if (error) {
            										    this.log('setNextInput - error: ', error.message);
													} else {
															this.log.info("Source change completed");
													}
												}.bind(this));
											}.bind(this), 500);
									}
								}.bind(this));

							}.bind(this), 500);
						}
					}.bind(this));

				}.bind(this), 500);
            }
        }.bind(this));
        callback(null, null);
    },

    getNextInput: function(callback, context) {
        callback(null, null);
    },

    /// Previous input
    setPreviousInput: function(inputState, callback, context) {
        this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, inputState);

        url = this.input_url;
        body = JSON.stringify({"key": "Source"});
        this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                this.log('setPreviousInput - error: ', error.message);
            } else {
                	this.log('Source - succeeded - current state: %s', inputState);

					setTimeout(function () {
					body = JSON.stringify({"key": "CursorDown"});

					this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
						if (error) {
			                this.log('setPreviousInput - error: ', error.message);
						} else {
								this.log('Down - succeeded - current state: %s', inputState);
								setTimeout(function () {
								body = JSON.stringify({"key": "CursorLeft"});

								this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
									if (error) {
						                this.log('setPreviousInput - error: ', error.message);
									} else {
											this.log('Right - succeeded - current state: %s', inputState);
											setTimeout(function() {
												body = JSON.stringify({"key": "Confirm"});
												
												this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
													if (error) {
										                this.log('setPreviousInput - error: ', error.message);
													} else {
															this.log.info("Source change completed");
													}
												}.bind(this));
											}.bind(this), 500);
									}
								}.bind(this));

							}.bind(this), 500);
						}
					}.bind(this));

				}.bind(this), 500);
            }
        }.bind(this));
        callback(null, null);
    },

    getPreviousInput: function(callback, context) {
        callback(null, null);
    },

    identify: function(callback) {
        this.log("Identify requested!");
        callback(); // success
    },

    getActiveIdentifier: function(callback) {
        callback(null, 1);
    },

    setActiveIdentifier: function(identifier, callback){
        callback(null, identifier);
    },

    sendKey: function(key, callback) {
        body = JSON.stringify({"key": key});
        this.pathRequest("/input/key", body, "POST", function(error, response, responseBody) {
            callback(null);
        });
    },

    setRemoteKey: function(key, callback){
        var value = "";
        var that = this;
        var onError = function(err) {
          that.log(err);
          if (callback) callback();
        };
        var onSucces = function(data) {
          if (callback) callback();
        };
        that.log("Pressed key: ", key);

        switch(key){
            case Characteristic.RemoteKey.REWIND:
            value="Rewind";
            break;
            case Characteristic.RemoteKey.FAST_FORWARD:
            value="FastForward";
            break;
            case Characteristic.RemoteKey.NEXT_TRACK:
            value="Next";
            break;
            case Characteristic.RemoteKey.PREVIOUS_TRACK:
            value="Previous";
            break;
            case Characteristic.RemoteKey.ARROW_UP:
            value="CursorUp";
            break;
            case Characteristic.RemoteKey.ARROW_DOWN:
            value="CursorDown"
            break;
            case Characteristic.RemoteKey.ARROW_LEFT:
            value="CursorLeft";
            break;
            case Characteristic.RemoteKey.ARROW_RIGHT:
            value="CursorRight";
            break;
            case Characteristic.RemoteKey.SELECT:
            value="Confirm";
            break;
            case Characteristic.RemoteKey.BACK:
            value="Back";
            break;
            case Characteristic.RemoteKey.EXIT:
            value="Home";
            break;
            case Characteristic.RemoteKey.PLAY_PAUSE:
            value="PlayPause";
            break;
            case Characteristic.RemoteKey.INFORMATION:
            value="Info";
            break;
          }
        this.sendKey(value, onSucces);
    },

    getBrightness: function(callback) {
        this.log("Getting brightness: ", this.ambilight_brightness);
        this.ambilight_brightness.getValue(callback, "");
    },

    setBrightness: function(value, callback) {
        this.ambilight_brightness.setValue(callback, "");
    },

    getBrightnessState: function(callback) {
        callback(null, 1);
    },

    setBrightnessState: function(value, callback) {
        callback(null, value);
    },

    getServices: function() {
        var that = this;

        this.services = [];

        this.tvService = new Service.Television(this.name);
        this.tvService.setCharacteristic(Characteristic.ConfiguredName, this.name);
        this.tvService
          .setCharacteristic(
            Characteristic.SleepDiscoveryMode,
            Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
          );
        this.tvService
          .getCharacteristic(Characteristic.Active)
          .on('set', this.setBrightnessState.bind(this))
          .on('get', this.getPowerState.bind(this));
      
        this.tvService.setCharacteristic(Characteristic.ActiveIdentifier, 0);
        this.tvService
          .getCharacteristic(Characteristic.ActiveIdentifier)
          .on('set', this.setActiveIdentifier.bind(this))
          .on('get', this.getActiveIdentifier.bind(this));
      
        this.tvService
          .getCharacteristic(Characteristic.RemoteKey)
          .on('set', this.setRemoteKey.bind(this));
        this.services.push(this.tvService);
      
        /*this.speakerService = new Service.TelevisionSpeaker();
        this.speakerService
          .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
        this.speakerService
          .setCharacteristic(Characteristic.Name, this.soundoutput);
        this.speakerService
            .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
        this.speakerService
          .getCharacteristic(Characteristic.VolumeSelector) //increase/decrease volume
          .on('set', this.setVolumeSelector.bind(this));
        this.speakerService
            .getCharacteristic(Characteristic.Mute)
          .on('get', this.getMuted.bind(this))
          .on('set', this.setMuted.bind(this));
          this.speakerService.getCharacteristic(Characteristic.Volume)
          .on('get', this.getVolume.bind(this))
          .on('set', this.setVolume.bind(this));
        this.services.push(this.speakerService);*/

        var informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.Manufacturer, 'Philips')
            .setCharacteristic(Characteristic.Model, "Year " + this.model_year);

        // POWER
        /*this.switchService = new Service.Switch(this.name + " Power", '0a');
        this.switchService
            .getCharacteristic(Characteristic.On)
            .on('get', this.getPowerState.bind(this))
            .on('set', this.setPowerState.bind(this));*/

        if (this.has_ambilight) {
            // AMBILIGHT
            this.ambilightService = new Service.Lightbulb(this.name + " Brightness", '0e');
            this.ambilightService
                .getCharacteristic(Characteristic.On)
                .on('get', this.getBrightnessState.bind(this))
                .on('set', this.setBrightnessState.bind(this));

        	this.ambilightService
            	.getCharacteristic(Characteristic.Brightness)
            	.on('get', this.getBrightness.bind(this))
                .on('set', this.setBrightness.bind(this));
                
            this.services.push(this.ambilightService);

            return this.services;
        } else {
            return this.services;
        }
    }
};