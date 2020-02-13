var Service;
var Characteristic;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var wol = require('wake_on_lan');
var exec = require("child_process").exec;

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerAccessory("homebridge-philipstv-enhanced", "PhilipsTV", HttpStatusAccessory);
}

function HttpStatusAccessory(log, config, api) {
	this.log = log;
	this.api = api;
	var that = this;

	// CONFIG
	this.ip_address = config["ip_address"];
	this.name = config["name"];
	this.poll_status_interval = config["poll_status_interval"] || "0";
	this.model_year = config["model_year"] || "2018";
	this.wol_url = config["wol_url"] || "";
	this.wol_urls = config["wol_urls"] || [];
	this.has_chromecast = config["has_chromecast"] || false;
	if (this.wol_url != "") {
		this.wol_urls.push(this.wol_url);
	}
	this.model_year_nr = parseInt(this.model_year);
	this.set_attempt = 0;
	this.has_ambilight = config["has_ambilight"] || false;
	this.has_ssl = config["has_ssl"] || false;
	this.has_input_selector = !(config["hide_input_selector"] || false);
	this.etherwake_exec = config["etherwake_exec"];
	this.info_button = config["info_button"] || "Source";
	this.playpause_button = config["playpause_button"] || "Options";
	this.serial_number = config["serial_number"] || this.wol_urls[0] || "123456789";
	this.enabled_services = [];

	// CREDENTIALS FOR API
	this.username = config["username"] || "";
	this.password = config["password"] || "";

	// CHOOSING API VERSION BY MODEL/YEAR
	if (this.model_year_nr >= 2016) {
		this.api_version = 6;
	} else if (this.model_year_nr >= 2014) {
		this.api_version = 5;
	} else {
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
	this.state_muted = false;
	this.state_volume = 0;

	// Define URL & JSON Payload for Actions

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
	this.ambilight_status_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/menuitems/settings/current";
	this.ambilight_brightness_body = JSON.stringify({"nodes":[{"nodeid":200}]});
	this.ambilight_mode_body = JSON.stringify({"nodes":[{"nodeid":100}]});
	
	this.ambilight_config_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/menuitems/settings/update";
	this.ambilight_power_on_body = JSON.stringify({"value":{"Nodeid":100,"Controllable":true,"Available":true,"data":{"activenode_id":120}}}); // Follow Video 
	this.ambilight_power_off_body = JSON.stringify({"value":{"Nodeid":100,"Controllable":true,"Available":true,"data":{"activenode_id":110}}}); // Off

	this.chromecast_url = this.has_chromecast ? ("http://" + this.ip_address + ":8080/apps/ChromeCast") : null;

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
			if (that.tvService) {
				that.tvService.getCharacteristic(Characteristic.Active).setValue(that.state_power, null, "statuspoll");
			}
		});

		var statusemitter_muted = pollingtoevent(function(done) {
			that.getMutedState(function(error, response) {
				done(error, response, that.set_attempt);
			}, "statuspoll");
		}, {
			longpolling: true,
			interval: that.interval * 1000,
			longpollEventName: "statuspoll_muted"
		});

		statusemitter.on("statuspoll_muted", function(data) {
			that.state_muted = data;
			if (that.tvSpeakerService) {
				that.tvSpeakerService.getCharacteristic(Characteristic.Mute).setValue(that.state_muted, null, "statuspoll");
			}
		});

		var statusemitter_volume = pollingtoevent(function(done) {
			that.getVolumeLevel(function(error, response) {
				done(error, response, that.set_attempt);
			}, "statuspoll");
		}, {
			longpolling: true,
			interval: that.interval * 1000,
			longpollEventName: "statuspoll_volume"
		});

		statusemitter.on("statuspoll_volume", function(data) {
			that.state_volume = data;
			if (that.tvSpeakerService) {
				that.tvSpeakerService.getCharacteristic(Characteristic.Volume).setValue(that.state_volume, null, "statuspoll");
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

	this.prepareServices();
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
			timeout: 2000
		};

		options.followAllRedirects = true;

		// EXTRA CONNECTION SETTINGS FOR API V6 (HTTP DIGEST)
		if (need_authentication) {
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

	wolRequest: function(url, callback) {
		var that = this;
		this.log.debug('calling WOL with URL %s', url);
		if (!url) {
			callback(url, null, "EMPTY");
			return;
		}
		if (url.substring(0, 3).toLowerCase() == "wol") {
			//Wake on lan request
			var macAddress = url.replace(/^wol[:]?[\/]?[\/]?/ig, "");

			var wol_wake = function() {
				wol.wake(macAddress, function(error) {
					if (error) {
						that.log("WakeOnLan failed: %s", error);
						callback(url, error);
					} else {
						callback(url, null, "OK");
					}
				});
			}

			this.log.debug("Executing WakeOnLan request to " + macAddress);
			if (this.etherwake_exec) {
				exec(this.etherwake_exec + " '" + macAddress + "'", function(error, stdout, stderr) {
					if (error) {
						that.log("Error with " + that.etherwake_exec + ": " + stderr + " " + stdout);
						wol_wake();
					} else {
						that.log.debug(that.etherwake_exec + " success " + stdout);
						callback(url, null, stdout);
					}
			})
			} else {
				wol_wake();
			}
		} else {
			if (url.length > 3) {
				callback(url, new Error("Unsupported protocol: ", "ERROR"));
			} else {
				callback(url, null, "EMPTY");
			}
		}
	},

	// POWER FUNCTIONS
	setPowerStateLoop: function(nCount, url, body, powerState, callback) {
		var that = this;

		that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
			if (error) {
				if (nCount > 0) {
					that.log.debug('setPowerStateLoop - powerstate attempt %s: %s', nCount - 1, url);
					setTimeout(function() {
						that.setPowerStateLoop(nCount - 1, url, body, powerState, function(err, state_power) {
							callback(err, state_power);
						});
					}, 300);
				} else {
					that.log('setPowerStateLoop failed: %s %s', url, error.message);
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
			body = this.power_on_body;
			this.log.debug("setPowerState - Will power on");
			var called_back = false;
			var send_chromecast = this.has_chromecast;
			for (var i = 0; i < this.wol_urls.length; ++i)  {
				var wol_url = this.wol_urls[i]
				that.log('setPowerState - Sending WOL ' + wol_url);
				this.wolRequest(wol_url, function(wol_id, error, response) {
					that.log('setPowerState - WOL callback %s response: %s', wol_id, response);
					var send_powerstate = function() {
						that.setPowerStateLoop(8, url, body, powerState, function(error, state_power) {
							that.state_power = state_power;
							if (error) {
								that.log("setPowerStateLoop - ERROR: %s", error);
							}
							if (!called_back) {
								called_back = true;
								callback(error, that.state_power);
							}
							if (that.tvService) {
								that.tvService.getCharacteristic(Characteristic.Active).setValue(that.state_power, null, "statuspoll");
							}
						});
					};
					setTimeout(function() {
						if (send_chromecast) {
							send_chromecast = false;
							that.log.debug("Sending ChromeCast: %s", this.chromecast_url);
							that.httpRequest(this.chromecast_url, null, "POST", false, function(error, response, responseBody) {
								that.log.debug("ChromeCast sent: %s: %s %s", response, error, responseBody);
								if (!that.state_power) {
									send_powerstate();
								}
							});
						} else {
							if (!that.state_power) {
								send_powerstate();
							}
						}
					}, 500);
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
				if (that.tvService) {
					that.tvService.getCharacteristic(Characteristic.Active).setValue(that.state_power, null, "statuspoll");
				}
				if (that.ambilightService) {
					that.state_ambilight = false;
					that.ambilightService.getCharacteristic(Characteristic.On).setValue(that.state_ambilight, null, "statuspoll");
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
				if (error.message == "ETIMEDOUT") {
					that.log.debug('%s - ERROR: %s', fctname, error.message);
				} else {
					that.log('%s - ERROR: %s', fctname, error.message);
				}
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

	setMutedStateLoop: function(nCount, url, body, mutedState, callback) {
		var that = this;

		that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
			if (error) {
				if (nCount > 0) {
					that.log('setMutedStateLoop - attempt, attempt id: ', nCount - 1);
					that.setMutedStateLoop(nCount - 1, url, body, mutedState, function(err, state) {
						callback(err, state);
					});
				} else {
					that.log('setMutedStateLoop - failed: %s', error.message);
					mutedState = false;
					callback(new Error("HTTP attempt failed"), mutedState);
				}
			} else {
				that.log('setMutedStateLoop - succeeded - current state: %s', mutedState);
				callback(null, mutedState);
			}
		});
	},

	setMutedState: function(mutedState, callback, context) {
		var url = this.audio_url;
		var body;
		var that = this;

		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, mutedState);

		//if context is statuspoll, then we need to ensure that we do not set the actual value
		if (context && context == "statuspoll") {
			callback(null, mutedState);
			return;
		}

		this.set_attempt = this.set_attempt + 1;

		if (mutedState) {
			body = this.audio_mute_body;
			this.log("setMutedState - setting state to on");
		} else {
			body = this.audio_unmute_body;
			this.log("setMutedState - setting state to off");
		}

		that.setMutedStateLoop(0, url, body, mutedState, function(error, state) {
			that.state_muted = mutedState;
			if (error) {
				that.state_muted = false;
				that.log("setMutedState - ERROR: %s", error);
				if (that.tvSpeakerService) {
					that.tvSpeakerService.getCharacteristic(Characteristic.Mute).setValue(that.state_muted, null, "statuspoll");
				}
			}
			callback(error, that.state_muted);

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
			that.state_volume = volumeLevel;
			if (error) {
				that.state_volume = false;
				that.log("setMutedState - ERROR: %s", error);
				if (that.tvSpeakerService) {
					that.tvSpeakerService.getCharacteristic(Characteristic.Mute).setValue(that.state_volume, null, "statuspoll");
				}
			}
			callback(error, that.state_volume);
		}.bind(this));
	},

	getMutedState: function(callback, context) {
		var that = this;
		var url = this.audio_url;

		this.log.debug("Entering %s with context: %s and current state: %s", arguments.callee.name, context, this.state_muted);

		//if context is statuspoll, then we need to request the actual value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
			callback(null, this.state_muted);
			return;
		}
		if (!this.state_power) {
				callback(null, false);
				return;
		}
		
		this.httpRequest(url, "", "GET", this.need_authentication, function(error, response, responseBody) {
			var tResp = that.state_muted;
			var fctname = "getMutedState";
			if (error) {
				that.log('%s - ERROR: %s', fctname, error.message);
			} else {
				if (responseBody) {
					var responseBodyParsed;
					try {
						responseBodyParsed = JSON.parse(responseBody);
						if (responseBodyParsed) {
							tResp = (responseBodyParsed.muted == "true") ? 1 : 0;
							that.log.debug('%s - got answer %s', fctname, tResp);
						} else {
							that.log("%s - Could not parse message: '%s', not updating state", fctname, responseBody);
						}
					} catch (e) {
						that.log("%s - Got non JSON answer - not updating state: '%s'", fctname, responseBody);
					}
				}
				if (that.state_muted != tResp) {
					that.log('%s - state changed to: %s', fctname, tResp);
					that.state_muted = tResp;
				}
			}
			callback(null, tResp);
		}.bind(this));
	},

	getVolumeLevel: function(callback, context) {
		var that = this;
		var url = this.audio_url;

		this.log.debug("Entering %s with context: %s and current value: %s", arguments.callee.name, context, this.state_volume);
		//if context is statuspoll, then we need to request the actual value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
			callback(null, this.state_volume);
			return;
		}
		if (!this.state_power) {
				callback(null, 0);
				return;
		}

		this.httpRequest(url, "", "GET", this.need_authentication, function(error, response, responseBody) {
			var tResp = that.state_volume;
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
				if (that.state_volume != tResp) {
					that.log('%s - Level changed to: %s', fctname, tResp);
					that.state_volume = tResp;
				}
			}
			callback(null, that.state_volume);
		}.bind(this));
	},

	pressRemoteButton: function(remoteKey, callback, context) {
		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, remoteKey);

		var button = "";
		switch (remoteKey) {
		case Characteristic.RemoteKey.REWIND:
			button = "Rewind";
			break;
		case Characteristic.RemoteKey.FAST_FORWARD:
			button = "FastForward";
			break;
		case Characteristic.RemoteKey.NEXT_TRACK:
			button = "Next";
			break;
		case Characteristic.RemoteKey.PREVIOUS_TRACK:
			button = "Previous";
			break;
		case Characteristic.RemoteKey.ARROW_UP:
			button = "CursorUp";
			break;
		case Characteristic.RemoteKey.ARROW_DOWN:
			button = "CursorDown";
			break;
		case Characteristic.RemoteKey.ARROW_LEFT:
			button = "CursorLeft";
			break;
		case Characteristic.RemoteKey.ARROW_RIGHT:
			button = "CursorRight";
			break;
		case Characteristic.RemoteKey.SELECT:
			button = "Confirm";
			break;
		case Characteristic.RemoteKey.BACK:
			button = "Back";
			break;
		case Characteristic.RemoteKey.EXIT:
			button = "Exit";
			break;
		case Characteristic.RemoteKey.PLAY_PAUSE:
			button = this.playpause_button || "PlayPause";
			break;
		case Characteristic.RemoteKey.INFORMATION:
			button = this.info_button || "Options";
			break;
		default:
			this.log("Unknown remote key: %s", remoteKey);
			button = "";
			break;
		}
		if (button != "") {
			url = this.input_url;
			body = JSON.stringify({ "key": button });
			this.log.debug("Sending button: %s", body);
			this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
				if (error) {
					this.log('pressRemoteButton - error: ', error.message);
				}
			}.bind(this));
		}
		callback(null, null);
	},

	pressMenuButton: function(state, callback, context) {
		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, state);
		url = this.input_url;
		body = JSON.stringify({ "key": "Options" });
		this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
			if (error) {
				this.log('pressMenuButton - error: ', error.message);
			}
		}.bind(this));
		callback(null, null);
	},

	pressVolumeButton: function(state, callback, context) {
		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, state);
		url = this.input_url;
		body = JSON.stringify({ "key": (state ? "VolumeDown" : "VolumeUp") });
		this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
			if (error) {
				this.log('pressVolumeButton - error: ', error.message);
			}
		}.bind(this));
		callback(null, null);
	},

	getInputSource: function(callback, context) {
		callback(null, 2);
	},

	setInputSource: function(source, callback, context) {
		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, source);

		if (source == 1) {
			this.setPreviousInput(true, () => { callback(null, 2) }, context);
		} else if (source == 3) {
			this.setNextInput(true, () => { callback(null, 2) }, context);
		}
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
					this.log.debug('Source - succeeded - current state: %s', inputState);

					setTimeout(function () {
					body = JSON.stringify({"key": "CursorRight"});

					this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
						if (error) {
							 this.log('setNextInput - error: ', error.message);
						} else {
								this.log.debug('Right - succeeded - current state: %s', inputState);
								setTimeout(function () {
								body = JSON.stringify({"key": "CursorDown"});

								this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
									if (error) {
										 this.log('setNextInput - error: ', error.message);
									} else {
											this.log.debug('Down - succeeded - current state: %s', inputState);
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
					this.log.debug('Source - succeeded - current state: %s', inputState);

					setTimeout(function () {
					body = JSON.stringify({"key": "CursorLeft"});

					this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
						if (error) {
							this.log('setPreviousInput - error: ', error.message);
						} else {
								this.log.debug('Left - succeeded - current state: %s', inputState);
								setTimeout(function () {
								body = JSON.stringify({"key": "CursorUp"});

								this.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
									if (error) {
										this.log('setPreviousInput - error: ', error.message);
									} else {
											this.log.debug('Up - succeeded - current state: %s', inputState);
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

	prepareServices: function() {
		var that = this;

		this.informationService = new Service.AccessoryInformation();
		this.informationService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, 'Philips')
			.setCharacteristic(Characteristic.Model, "Year " + this.model_year)
			.setCharacteristic(Characteristic.SerialNumber, this.serial_number);
		this.enabled_services.push(this.informationService);

		this.tvService = new Service.Television(this.name, 'tvService' + this.name);
		this.tvService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.ConfiguredName, this.name)
			.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE)
			.setCharacteristic(Characteristic.ActiveIdentifier, -1)
			.setCharacteristic(Characteristic.Active, false);

		this.tvService.getCharacteristic(Characteristic.Active)
			.on('get', this.getPowerState.bind(this))
			.on('set', this.setPowerState.bind(this));
		this.tvService.getCharacteristic(Characteristic.RemoteKey)
			.on('set', this.pressRemoteButton.bind(this));
		this.tvService.getCharacteristic(Characteristic.PowerModeSelection)
			.on('set', this.pressMenuButton.bind(this));
		this.enabled_services.push(this.tvService);
		this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('get', this.getInputSource.bind(this))
			.on('set', this.setInputSource.bind(this));

		this.speakerService = new Service.TelevisionSpeaker(this.name + ' Volume', 'tvSpeakerService');
		this.speakerService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
		this.speakerService
			.getCharacteristic(Characteristic.Mute)
			.on('get', this.getMutedState.bind(this))
			.on('set', this.setMutedState.bind(this));
		this.speakerService
			.getCharacteristic(Characteristic.VolumeSelector)
			.on('set', this.pressVolumeButton.bind(this));
		this.speakerService
			.addCharacteristic(Characteristic.Volume)
			.on('get', this.getVolumeLevel.bind(this))
			.on('set', this.setVolumeLevel.bind(this));
		this.tvService.addLinkedService(this.speakerService);
		this.enabled_services.push(this.speakerService);

		if (this.has_input_selector) {
			this.previousInputSource = new Service.InputSource(this.name, this.name + ' Previous Input');
			this.previousInputSource
				.setCharacteristic(Characteristic.Identifier, 1)
				.setCharacteristic(Characteristic.ConfiguredName, "Previous Input")
				.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
				.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
			this.previousInputSource.getCharacteristic(Characteristic.ConfiguredName).setProps({ perms: [Characteristic.Perms.READ] });
			this.tvService.addLinkedService(this.previousInputSource);

			this.currentInputSource = new Service.InputSource(this.name, this.name + ' Input');
			this.currentInputSource
				.setCharacteristic(Characteristic.Identifier, 2)
				.setCharacteristic(Characteristic.ConfiguredName, "On Input")
				.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
				.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
			this.currentInputSource.getCharacteristic(Characteristic.ConfiguredName).setProps({ perms: [Characteristic.Perms.READ] });
			this.tvService.addLinkedService(this.currentInputSource);

			this.nextInputSource = new Service.InputSource(this.name, this.name + ' Next Input');
			this.nextInputSource
				.setCharacteristic(Characteristic.Identifier, 3)
				.setCharacteristic(Characteristic.ConfiguredName, "Next Input")
				.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
				.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
			this.nextInputSource.getCharacteristic(Characteristic.ConfiguredName).setProps({ perms: [Characteristic.Perms.READ] });
			this.tvService.addLinkedService(this.nextInputSource);

			this.enabled_services.push(this.previousInputSource);
			this.enabled_services.push(this.currentInputSource);
			this.enabled_services.push(this.nextInputSource);
		}

		if (this.has_ambilight) {
			// AMBILIGHT
			this.ambilightService = new Service.Lightbulb(this.name + " Ambilight", '0e');
			this.ambilightService
				.getCharacteristic(Characteristic.On)
				.on('get', this.getAmbilightState.bind(this))
				.on('set', this.setAmbilightState.bind(this));

			this.ambilightService
				.getCharacteristic(Characteristic.Brightness)
				.on('get', this.getAmbilightBrightness.bind(this))
				.on('set', this.setAmbilightBrightness.bind(this));

			this.enabled_services.push(this.ambilightService);
		}

		return this.enabled_services;
	},

	getServices: function() {
		return this.enabled_services;
	},
};
