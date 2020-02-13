# homebridge-philipstv-enhanced
Homebridge module for Philips TV (with JointSpace enabled) with Power on/off, Sound, Ambilight and source input control

# Description

This plugin is a fork of [gw-wiscon](https://github.com/gw-wiscon)'s
[homebridge-philipstv-x](https://www.npmjs.com/package/homebridge-philipstv-x)
with additional support for Sound control, Ambilight brightness control and
input selection control by [jebabin](https://github.com/jebabin).
It has been modified to work on a 43PUS6753 TV (2018 model without Android)
and may not work on older one. Code may need ajustement for Ambilight to work
on other 2018 models.

This was further modified by [Arkku](https://github.com/arkku) to use the
HomeKit Television service, which allows remote control from the Control Center
widget (including volume control by pressing the physical volume up/down
buttons). Other modifications include ChromeCast-based power-on option, and
support for an external "etherwake" executable.

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-philipstv-enhanced`
3. Update your configuration file. See the sample below.

If you do not wish to install from npm (e.g, because you are using a fork), you
may also clone the git repository into some directory like
`/usr/local/homebridge/plugins/homebridge-philipstv-enhanced` and then specify the
plugin directory as an option (`-P /usr/local/homebridge/plugins`, typically
using `HOMEBRIDGE_OPTS` in `/etc/default/homebridge`).

# Configuration
 
Example accessory config (needs to be added to the Homebridge `config.json`):

  ```
 "accessories": [
     {
        "accessory": "PhilipsTV",
        "name": "TV",
        "ip_address": "10.0.1.23",
        "poll_status_interval": "60",
        "model_year": 2018,
        "has_ssl": true,
        "has_ambilight": true,
        "has_chromecast": true,
        "hide_input_selector": false,
        "info_button": "Source",
        "playpause_button": "Options",
        "wol_url": "wol://18:8e:d5:a2:8c:66"
     }
 ]
  ```
 
To be able to power on the TV when the TV is in standby mode, you will need the `wol_url` 
parameter with the MAC address of your TV. You may also specify
`etherwake_exec` with a path to the `etherwake` executable (takes the MAC
address as argument). In some cases this seems to work using
`/usr/sbin/ethewrake` when the built-in WoL fails, so try both before giving
up.

 ```
"accessories": [
    {
        "accessory": "PhilipsTV",
        "name": "TV",
        "ip_address": "10.0.1.23",
        "poll_status_interval": "60",
        "model_year" : "2018",
        "has_ssl": false,
        "wol_url": "wol://18:8e:d5:a2:8c:66",
        "etherwake_exec": "/usr/sbin/etherwake"
    }
]
 ```

For TVs with a built-in ChromeCast, you may also have better success waking it
up through that. This is supported with the option `"has_chromecast": true`, in
which case the ChromeCast URL is accessed before trying using the typical power
state method. You may need to enable ChromeCast power-up option in the TV settings
menu (this will increase standby power consumption, so try first if your TV
wakes up consistently without it).

The Control Center widget info button is mapped to the options menu by default,
but may be configured to any other remote button (e.g., `Home` or `Source`)
with the option `"info_button": "Options"`. Likewise the play/pause button may
be remapped, with `"playpause_button": "PlayPause"`. The somewhat flaky input
source selector (which simply sends a sequence of buttons, hoping to change the
input) may be disabled with `"hide_input_selector": true`.

# Credentials for 2016 (and newer?) models with Android TV

As per [this project](https://github.com/suborb/philips_android_tv) the Android TV 2016 models Philips use an authenticated HTTPS [JointSpace](http://jointspace.sourceforge.net/) API version 6.
Every control- or status-call needs [digest authentification](https://en.wikipedia.org/wiki/Digest_access_authentication) which contains of a pre generated username and password. You have to do this once for your TV. We reccomend to use the python script [philips\_android\_tv](https://github.com/suborb/philips_android_tv).

Here is an example pairing call for philips\_android\_tv :
```
python ./philips.py --host 10.0.1.23 pair
```

You can then add username and password key in your homebridge config, example:
```
"accessories": [
  {
  	"accessory": "PhilipsTV",
  	"name": "TV",
  	"ip_address": "10.0.1.23",
  	"poll_status_interval": "60",
  	"model_year": 2016,
  	"has_ambilight": true,
  	"has_ssh": true,
  	"username": "deadbeef0815",
  	"password": "deadbeef0815deadbeef0815deadbeef0815deadbeef0815deadbeef0815",
  }
]
 ```
# Todo

We should auto detect TV capacity (http/https) and API version by requesting http://tvip:1925/1/system and https://tvip:1926/1/system

a 2018 TV will answer to /1/system and will report the API version is 6.1

For ambilight, we should parse /6/menuitems/settings/structure to instead of relying on static nodeid in the code
For audio, we should read /API_VERSION/audio/volume to get the max, and map the 0-100% of HomeKit to 0-TVMax. Currently 25 is assumed as max, so we divide homekit value by 4. 43PUS6753 has a volume max to 60 but 25 is already high

The code need cleanup. Especially it would be nice to use a generic setXStateLoop function, work stated with httpRequest_with_retry

Get function for audio/ambilight/etc. should be modified to attend nothing when the TV is off. When the TV turn on, we should refresh all values

# Dev notes about JointSpace URLs

POST to /6/menuitems/settings/current allow to get current Ambilight settings
POST to /6/menuitems/settings/update allow to update Ambilight settings
GET to /6/menuitems/settings/structure allow to have the details of the menu and options

