const fs_sync = require("fs")
const path = require('path')

if (!fs_sync.existsSync(path.join(__dirname, "/areas.json"))) {
    fs_sync.writeFileSync(path.join(__dirname, "/areas.json"), "{}")
}

const geoip = require("geoip-lite")
const nc = require("nominatim-client")
const axios = require("axios")
const express = require("express")
var areas = require("./areas.json")
const fs = require("fs/promises")
const cors = require("cors")

const app = express()
const nominatim = nc.createClient({
    "useragent": "DTV Tools",
    "referer": "https://dtvtools.ucomsite.my.id/"
})

app.enable("trust proxy")
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']) 

const getNearestDistance = (lat1, lon1, lat2, lon2, unit) => {
	if ((lat1 == lat2) && (lon1 == lon2)) {
		return 0;
	}
	else {
		var radlat1 = Math.PI * lat1/180;
		var radlat2 = Math.PI * lat2/180;
		var theta = lon1-lon2;
		var radtheta = Math.PI * theta/180;
		var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
		if (dist > 1) {
			dist = 1;
		}
		dist = Math.acos(dist);
		dist = dist * 180/Math.PI;
		dist = dist * 60 * 1.1515;
		if (unit=="K") { dist = dist * 1.609344 }
		if (unit=="N") { dist = dist * 0.8684 }
		return dist;
	}
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "/dtvtools.html"))
})

const geoIp = (ip, res) => {
    return res.status(200).json(geoip.lookup(ip))
}

app.get("/geoip/json/", cors(), (req, res) => {
    return geoIp(req.ip, res)
})

app.get("/geoip/json/:ip", cors(), (req, res) => {
    return geoIp(req.params.ip, res)
})

app.get("/dtv/id", (req, res) => {
    res.sendFile(path.join(__dirname, "/scanner.html"))
})

app.get("/dtv/id/region", async (req, res) => {
    try {
        var [target_lat, target_lng] = [0,0]
        if (req.query.ip) {
            const lookup_result = geoip.lookup(req.query.ip)                
            if (!lookup_result || lookup_result.country.toUpperCase() != "ID") {
                return res.status(200).json({"region":"N/A"})
            }
            [target_lat, target_lng] = lookup_result.ll
        } else if (req.query.lat && req.query.lng) {        
            const lookup_result = await nominatim.reverse({lat: parseFloat(req.query.lat), lon: parseFloat(req.query.lng), zoom: 16})                
            if (lookup_result.error || lookup_result.address.country_code.toUpperCase() != "ID") {
                return res.status(200).json({"region":"N/A"})
            }
            [target_lat, target_lng] = [parseFloat(req.query.lat), parseFloat(req.query.lng)]
        } else {
            const lookup_result = geoip.lookup(req.ip)         
            if (!lookup_result || lookup_result.country != "ID") {
                return res.status(200).json({"region":"N/A"})            
            }
            [target_lat, target_lng] = lookup_result.ll
        }        
        const transmitters = await axios.get("https://digitaltv.kominfo.go.id/executive/get_antenna_map")
        const tx_data = transmitters.data

        var near_tx = {}
        var min_distance = -1

        for (i = 0; i<tx_data.data.length; i++) {
            const tx_loc = [tx_data.data[i].lat, tx_data.data[i].lng]
            const new_dist = getNearestDistance(target_lat, target_lng, tx_loc[0], tx_loc[1], "K")

            if (min_distance == -1 || new_dist <= min_distance) {
                min_distance = new_dist
                near_tx = tx_data.data[i]
            }
        }

        const coverage = await axios.post("https://digitaltv.kominfo.go.id/executive/get_coverage_map", `antenna[]=${near_tx.id}`)
        return res.status(200).json({"region":coverage.data.data[0].area_service_name})
    } catch (e) {
        console.trace(e)
        return res.status(500).json(e)
    }
})

app.get("/dtv/id/area_channels", async (req, res) => {
    try {
        var [target_lat, target_lng] = [0,0]
        if (req.query.ip) {
            const lookup_result = geoip.lookup(req.query.ip)                
            if (!lookup_result || lookup_result.country.toUpperCase() != "ID") {
                return res.status(200).json({"transmitters":[],"channels":[]})
            }
            [target_lat, target_lng] = lookup_result.ll
        } else if (req.query.lat && req.query.lng) {
            const lookup_result = await nominatim.reverse({lat: parseFloat(req.query.lat), lon: parseFloat(req.query.lng), zoom: 16})
            if (lookup_result.error || lookup_result.address.country_code.toUpperCase() != "ID") {
                return res.status(200).json({"transmitters":[],"channels":[]})
            }
            [target_lat, target_lng] = [parseFloat(req.query.lat), parseFloat(req.query.lng)]
        } else {
            const lookup_result = geoip.lookup(req.ip)         
            if (!lookup_result || lookup_result.country != "ID") {
                return res.status(200).json({"transmitters":[],"channels":[]})          
            }
            [target_lat, target_lng] = lookup_result.ll
        }        
        const transmitters = await axios.get("https://digitaltv.kominfo.go.id/executive/get_antenna_map")
        const tx_data = transmitters.data

        var near_tx = {}
        var min_distance = -1

        for (i = 0; i<tx_data.data.length; i++) {
            const tx_loc = [tx_data.data[i].lat, tx_data.data[i].lng]
            const new_dist = getNearestDistance(target_lat, target_lng, tx_loc[0], tx_loc[1], "K")

            if (min_distance == -1 || new_dist <= min_distance) {
                min_distance = new_dist
                near_tx = tx_data.data[i]
            }
        }

        const coverage = await axios.post("https://digitaltv.kominfo.go.id/executive/get_coverage_map", `antenna[]=${near_tx.id}`)
        return res.status(200).json({"transmitters":coverage.data.transmitter_in_area,"channels":coverage.data.channel_in_area})
    } catch (e) {
        console.trace(e)
        return res.status(500).json(e)
    }
})

app.get("/dtv/id/channels", async (req, res) => {
    try {
        var [target_lat, target_lng] = [0,0]
        if (req.query.ip) {
            const lookup_result = geoip.lookup(req.query.ip)                
            if (!lookup_result || lookup_result.country.toUpperCase() != "ID") {
                return res.status(200).json({"mux_id": "out-of-country", "alias": [], "transmitters": [],"channels": []})
            }
            [target_lat, target_lng] = lookup_result.ll
        } else if (req.query.lat && req.query.lng) {
            const lookup_result = await nominatim.reverse({lat: parseFloat(req.query.lat), lon: parseFloat(req.query.lng), zoom: 16})
            if (lookup_result.error || lookup_result.address.country_code.toUpperCase() != "ID") {
                return res.status(200).json({"mux_id": "out-of-country", "alias": [], "transmitters": [],"channels": []})
            }
            [target_lat, target_lng] = [parseFloat(req.query.lat), parseFloat(req.query.lng)]
        } else {
            const lookup_result = geoip.lookup(req.ip) 
            if (!lookup_result || lookup_result.country != "ID") {
                return res.status(200).json({"mux_id": "out-of-country", "alias": [], "transmitters": [],"channels": []})
            }
            [target_lat, target_lng] = lookup_result.ll
        }        
        const transmitters = await axios.get("https://digitaltv.kominfo.go.id/executive/get_antenna_map")
        const tx_data = transmitters.data

        var near_tx = {}
        var min_distance = -1

        for (i = 0; i<tx_data.data.length; i++) {
            const tx_loc = [tx_data.data[i].lat, tx_data.data[i].lng]
            const new_dist = getNearestDistance(target_lat, target_lng, tx_loc[0], tx_loc[1], "K")

            if (min_distance == -1 || new_dist <= min_distance) {
                min_distance = new_dist
                near_tx = tx_data.data[i]
            }
        }

        const coverage = await axios.post("https://digitaltv.kominfo.go.id/executive/get_coverage_map", `antenna[]=${near_tx.id}`)
        const service_id = coverage.data.data[0].area_service_name.replace(/[^ -~]+/g, "").replace(/ /g, "-").toLowerCase()
        
        var area = areas[service_id]
        if (!area) {
            const tv_tx = []
            const v_tx = coverage.data.transmitter_in_area
            const tv_tx_ids = {}

            for (i = 0; i<v_tx.length; i++) {
                tv_tx.push({"id": parseInt(v_tx[i].id), "mux_id": "", "alias": [], "website": "", "name": v_tx[i].name, "frequency": v_tx[i].frequency, "uhf_channel": v_tx[i].channel, "lat": v_tx[i].latitude, "lng": v_tx[i].longitude})
                tv_tx_ids[v_tx[i].name] = v_tx[i].id
            }

            const tv_ch = []
            const v_ch = coverage.data.channel_in_area
            for (i = 0; i<v_ch.length; i++) {
                tv_ch.push({"channel_name": v_ch[i].name, "channel_id": "", "epg_id": "", "alias": [], "stream_urls": [], "parent": null, "via": parseInt(tv_tx_ids[v_ch[i].antenna]), "quality": v_ch[i].quality})
            }

            area = {"mux_id": service_id, "alias": [], "transmitters":tv_tx,"channels":tv_ch}
            areas[service_id] = area
            
            await fs.writeFile(path.join(__dirname, "/areas.json"), JSON.stringify(areas, null, 4))
            return res.status(200).json(area)
        } else {
            return res.status(200).json(area)
        }
    } catch (e) {
        console.trace(e)
        return res.status(500).json(e)
    }
})

const port = 40010
app.listen(port, "127.0.0.1", () => {console.log("Listening on port "+port)})
