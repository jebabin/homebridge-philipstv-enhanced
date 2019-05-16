function MenuItem(accessory, log, nodeid, is_polling) {
    this.accessory = accessory;
    this.log = log;
    this.nodeid = nodeid;
    this.is_polling = is_polling;
    this.state = 0;
    this.log("done setting up menu item: ", nodeid); 
}

MenuItem.prototype = {
    getValue: function(callback, context) {
        if ((!context || context != "statuspoll") && this.is_polling) {
            callback(null, this.state);
            return;
        }

        if (this.accessory.state_power == 0) {
            callback(null, this.state);
            return;
        }
        var that = this;
        this.accessory.pathRequest("/menuitems/settings/current", JSON.stringify({"nodes":[{"nodeid":this.nodeid}]}), "POST", function(error, response, responseBody) {
            that.log("data recvd: ", responseBody);
            resp = JSON.parse(responseBody);
            value = resp.values[0].value;
            data = value.data.value;
            that.state = data;
            callback(null, that.state);
        });
    },

    setValue: function(callback, context) {
        //TODO
    }
}

module.exports = MenuItem;
