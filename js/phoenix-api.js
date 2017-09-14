// Phoenix-API runs all of the background processes used by the publisher. 
// It emits events with info when things happen that have example definitions in `phoenix-ui.js`. 
// This allows you to subscribe to happening events to update your UI.


var PhoenixEvents = {};
_.extend(PhoenixEvents, Backbone.Events);

var librarianHost = "https://api.alexandria.io";

var PhoenixStatus = {
	status: 'waiting', 
	pubQueue: [], // Artifacts that are being published are added to the pubQueue.
	currentPublisher: { // This is the currently selected "Publisher"
		publisherAddress: 'floAddr',
		publisherName: 'Sky'
	}, 
	publishers: [{ // This contains all of the available publishers for the wallet. You can use this to select a new user.
		publisherAddress: '',
		publisherName: ''
	}], 
	artifacts: {
		pubAddress: [{},{}]
	},
	wallet: {},
	ipfs: {
		ipfs: {}, // The actual IPFS object currently being used
		host: '',
		port: '',
		protocol: ''
	}
}

var Phoenix = (function() {	
	var PhoenixAPI = {};

	PhoenixAPI.artifacts = {}
	PhoenixAPI.marketData = { timestamp: 0 };
	PhoenixAPI.librarydInfo = { timestamp: 0 };

	PhoenixAPI.tusIPFSEndpoint = "https://ipfs-tus.alexandria.io";
	PhoenixAPI.flovaultBaseURL = "https://flovault.alexandria.io";
	PhoenixAPI.tradebotURL = "https://api.alexandria.io/tradebot";
	PhoenixAPI.browserURL = "https://alexandria.io/browser/";
	PhoenixAPI.tusFiles = [];
	PhoenixAPI.publishQueue = (localStorage.publishQueue ? JSON.parse(localStorage.publishQueue) : []);
	PhoenixAPI.publishState = "Loading";
	PhoenixAPI.wipArtifacts = {};
	PhoenixAPI.currentArtifactPublish = ((localStorage.currentArtifactPublish && localStorage.currentArtifactPublish != "undefined") ? JSON.parse(localStorage.currentArtifactPublish) : {});
	PhoenixAPI.pendingUploadQueue = (localStorage.pendingUploadQueue ? JSON.parse(localStorage.pendingUploadQueue) : []);
	PhoenixAPI.sentPubUsers = (localStorage.sentPubUsers ? JSON.parse(localStorage.sentPubUsers) : []);
	PhoenixAPI.publishedArtifacts = (localStorage.publishedArtifacts ? JSON.parse(localStorage.publishedArtifacts) : []);
	PhoenixAPI.disabledArtifactTXIDs = (localStorage.disabledArtifactTXIDs ? JSON.parse(localStorage.disabledArtifactTXIDs) : []);
	PhoenixAPI.bulkTusFiles = [];

	// Load info from LibraryD
	PhoenixAPI.searchAPI = function(module, searchOn, searchFor) {
		if ( (searchOn == 'type') && (searchFor.length > 1) ) {
			searchFor = '['+searchFor+']';
		} else {
			searchFor = '"'+searchFor+'"';
		}
		queryString = '{"protocol":"'+ module +'","search-on":"'+ searchOn +'","search-for":'+searchFor+',"search-like": true}';
		var mediaData;
		$.ajax({
			type: "POST",
			url: librarianHost +'/alexandria/v2/search',
			data: queryString.toString(),
			success: function (e) {
				mediaData = $.parseJSON(e).response;
			},
			async:   false
		});

		return mediaData;
	}

	PhoenixAPI.register = function(username, password, email){
		var data = {};

		if (email)
			data = {email: email};

		$.post(PhoenixAPI.flovaultBaseURL + "/wallet/create", data, function (response) {
			if (response.error) {
				//swal("Error", "Registration failed, please try again!", "error");
				console.error(response.error);
				PhoenixEvents.trigger("onWalletCreateFail", response);
				return;
			}
			//identifierInput.val(response.identifier);
			PhoenixAPI.wallet = new Wallet(response.identifier, password);
			PhoenixAPI.wallet.setSharedKey(response.shared_key);
			//PhoenixAPI.wallet.store();

			// Create one address by default.
			PhoenixAPI.wallet.generateAddress();

			// Store wallet.
			PhoenixAPI.wallet.store();

			// Request 1 FLO from tradebot
			var address = "";
			for (var addr in PhoenixAPI.wallet.addresses) {
				address = PhoenixAPI.wallet.addresses[addr].addr;
			}

			if (address === ""){
				PhoenixEvents.trigger("onWalletCreateFail", {error: {type: "ADD_ADDRESS_ERR", message: "No address found, aborting..."}});
				return;
			}

			var faucetData = {
				flo_address: address,
				recaptcha: grecaptcha.getResponse()
			}

			$.post(PhoenixAPI.tradebotURL + "/faucet", faucetData, function(response){
				if (response.includes("reCAPTCHAv2 error!")){
					PhoenixEvents.trigger("reCAPTCHAFail", response);
					return;
				}

				var res = JSON.parse(response);

				if (res.success){
					var txid = res.txid;
					var inf = res['tx-info'].replace(/u'/g, "'").replace(/'/g, '"').replace(/Decimal\(\"/g, '').replace(/\"\)/g, '');
					var txinfo = JSON.parse(inf);
					var tmpVout = 1;
					for (var i = 0; i < txinfo.vout.length; i++){
						if (txinfo.vout[i].value == 1)
							tmpVout = txinfo.vout[i].n;
					}
					PhoenixAPI.wallet.known_unspent.push({ address: address, amount: 1, confirmations: -1, txid: res.txid, vout: tmpVout});

					LibraryDJS.announcePublisher(PhoenixAPI.wallet, username, address, "", email, function(err, data){
						if (err){
							PhoenixEvents.trigger("onPublisherAnnounceFail", err);
							console.error(err);
							return;
						} 

						PhoenixAPI.sentPubUsers.push({
							username: username,
							address: address,
							email: email
						});

						localStorage.sentPubUsers = JSON.stringify(PhoenixAPI.sentPubUsers);

						localStorage.setItem("identifier", PhoenixAPI.wallet.identifier);
						localStorage.setItem("loginWalletEnc", CryptoJS.AES.encrypt(password, PhoenixAPI.wallet.identifier));
						localStorage.setItem("remember-me", "true");


						PhoenixEvents.trigger("onPublisherAnnounceSuccess", {
							identifier: PhoenixAPI.wallet.identifier,
							username: username,
							address: address,
							email: email
						});

						// Redirect to main dashboard page.
						//window.location.href = 'index.html';
					});
				} else {
					console.error(res);
					PhoenixEvents.trigger("onFaucetFail", res);
				}
				
			});
			//$(".sweet-alert .lead").html("Register was successful, here is your identifier, please keep this safe or you may lose access to your coins and Publisher ID: <br><code>" + response.identifier + "</code><br>Your initial Florincoin address is: <br><code>" + address + "</code>");
		});
	}

	PhoenixAPI.checkEmail = function(email, callback){
		$.get(PhoenixAPI.flovaultBaseURL + "/wallet/checkload/" + email, function (response) {
			if (response.error){
				if (response.error.message === "Unable to find ID for Email"){
					callback(false);
				} else {
					callback(true);
				}
			} else {
				callback(true);
			}
		}, 'json');
	}

	// Used to login. Should we call this Sync or Async?
	PhoenixAPI.login = function(identifier, password){
		// Trigger the onLogin event
		PhoenixEvents.trigger("onLogin", {});

		if (!identifier || !password){
			if (typeof(Storage) !== "undefined") {
				if (localStorage.getItem("identifier") != ''){
					identifier = localStorage.identifier;

					Raven.setUserContext({
					    id: identifier
					});

					if (!localStorage.loginWalletEnc || localStorage.loginWalletEnc === ""){
						PhoenixEvents.trigger("onLoginFail", "Missing identifier or password and none found in localStorage!");
						return;
					}

					password = CryptoJS.AES.decrypt(localStorage.loginWalletEnc, identifier).toString(CryptoJS.enc.Utf8);

					$.get(flovaultBaseURL + "/wallet/checkload/" + identifier, function (response) {
						console.log(response);
						// if (response.gauth_enabled) {
						// 	// ToDo: add 2FA support, needs further research
						// 	PhoenixEvents.trigger("onLoginFail", { 
						// 		title: "Error!", 
						// 		type: "error", 
						// 		message: "Two Factor Authentication is not currently supported, please disable it or create a new wallet." 
						// 	});
						// }
						PhoenixAPI.wallet = new Wallet(response.identifier, password);
						PhoenixAPI.wallet.load(function () {
							if (localStorage["remember-me"] == "false"){
								localStorage.identifier = '';
								localStorage.loginWalletEnc = '';
							}

							PhoenixEvents.trigger("onLoginSuccess", {});
							PhoenixEvents.trigger("onWalletLoad", PhoenixAPI.wallet);

							PhoenixAPI.publishState = "Ready";

							PhoenixAPI.getPublishersFromLibraryD();
						});
					});
				} else {
					PhoenixEvents.trigger("onLoginFail", "Missing identifier or password and none found in localStorage!")
					// if (window.location.pathname.includes('index.html')){
					// 	window.location.href = 'login.html';
					// 	return;
					// }
				}
			} else {
				PhoenixEvents.trigger("onLoginFail", "Missing identifier or password and HTML5 LocalStorage is not supported.")
			    // console.log('No Support for storing locally.')
			}
		}
	}

	PhoenixAPI.twoAuthLogin = function(id, token, trust, callback){
		var data = {};

		data.identifier = id;
		data.token = token;
		data.is_trusted = trust;

		$.ajax({
			url : PhoenixAPI.flovaultBaseURL + "/wallet/gauth",
			type: "POST",
			data: JSON.stringify(data),
			contentType: "application/json; charset=utf-8",
			dataType   : "json",
			success    : function(response){
				if (response.error){
					callback(response, null);
				} else {
					callback(null, response);
					document.cookie = "auth_key=" + response.data.auth_key + ";expires=" + (new Date(response.data.expires)) + ';';
				}
			}
		});

		// $.post(PhoenixAPI.flovaultBaseURL + "/wallet/gauth", JSON.stringify(data), function (response) {
		// 	if (response.error){
		// 		callback(response, null);
		// 	} else {
		// 		callback(null, response);
		// 	}
		// }, 'json');
	}

	PhoenixAPI.logout = function(){
		localStorage.identifier = '';
		localStorage.loginWalletEnc = '';
		window.location.href = 'signin.html';
	}

	PhoenixAPI.clearAndLogout = function(){
		localStorage.clear();
		window.location.href = 'signin.html';
	}

	PhoenixAPI.loadWIPArtifacts = function(callback){
		try {
			var localWIP = JSON.parse(localStorage.wipArtifacts);

			var newWIPObj = {};
			for (var i in localWIP){
				if (localWIP && localWIP[i] && localWIP[i].artifactJSON && localWIP[i].artifactJSON.artifact){
					if (JSON.stringify(localWIP[i].artifactJSON) === '"{"artifact":{"type":"Audio-Basic","info":{"extraInfo":{"genre":"Acoustic"}},"storage":{"network":"IPFS","files":[]},"payment":{"fiat":"USD","scale":"1000:1","disPer":0.3,"sugTip":[],"tokens":{}}}}"')
						continue;

					newWIPObj[i] = localWIP[i];
				}
			}

			PhoenixAPI.wipArtifacts = newWIPObj;
		} catch (e) {
			PhoenixAPI.wipArtifacts = {};
		}
	}

	PhoenixAPI.saveWIPArtifacts = function(callback){
		localStorage.wipArtifacts = JSON.stringify(PhoenixAPI.wipArtifacts);
	}

	PhoenixAPI.createWIPArtifact = function(callback){
		// This UniqueID is just an internal ID that we reference the draft artifact by.
		var uniqueID = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);

		var newWIPArtifact = {
			artifactJSON: {},
			files: [],
			tusFiles: []
		}

		PhoenixAPI.wipArtifacts[uniqueID] = newWIPArtifact;

		PhoenixAPI.currentWIPID = uniqueID;

		PhoenixAPI.saveWIPArtifacts();

		callback(uniqueID);
	}

	PhoenixAPI.publishCurrentWIP = function(){
		var artJSON = PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].artifactJSON;
		PhoenixAPI.addAndPublishWIP(PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID])
		delete PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID];
		PhoenixAPI.currentWIPID = undefined;
		PhoenixAPI.saveWIPArtifacts();
	}

	PhoenixAPI.updateWIPArtifactJSON = function(artifactJSON){
		if (PhoenixAPI.wipArtifacts && PhoenixAPI.currentWIPID){
			if (!PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].artifactJSON){
				PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].artifactJSON = {}
			}

			PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].artifactJSON = artifactJSON;

			PhoenixAPI.saveWIPArtifacts();
		}
	}

	PhoenixAPI.addAndPublishWIP = function(wipArtifact){
		PhoenixAPI.pendingUploadQueue.push(wipArtifact);
	}

	PhoenixAPI.checkUploadStatus = function(){
		// Checks the upload status for all pendingUploadQueue items & publishes if finished uploading.
		for (var i = 0; i < PhoenixAPI.pendingUploadQueue.length; i++) {
			var wipArtifact = PhoenixAPI.pendingUploadQueue[i];

			if (!PhoenixAPI.pendingUploadQueue[i].tmpID){
				PhoenixAPI.pendingUploadQueue[i].tmpID = Math.random().toString(36).substring(7);
			}

			var publishObject = {
				artifactJSON: wipArtifact.artifactJSON,
				status: "Uploading"
			}

			var filesUploadState = [];

			var uploadComplete = true;
			for (var z = 0; z < wipArtifact.tusFiles.length; z++) {
				if (wipArtifact.tusFiles[z]){
					if (wipArtifact.tusFiles[z].id && wipArtifact.tusFiles[z].progress && parseFloat(wipArtifact.tusFiles[z].progress) === 100 && !wipArtifact.tusFiles[z].error){
						filesUploadState.push({
							uploadComplete: true,
							obj: wipArtifact.tusFiles[z]
						})
					} else {
						uploadComplete = false;
						filesUploadState.push({
							uploadComplete: false,
							obj: wipArtifact.tusFiles[z]
						})
					}
				}
			}

			if (uploadComplete){
				if (!PhoenixAPI.pendingUploadQueue[i].ipfsAddStart){
					var idsToAdd = [];

					var files = wipArtifact.artifactJSON.artifact.storage.files;

					for (var k = 0; k < files.length; k++) {
						if (wipArtifact.tusFiles){
							for (var j = 0; j < wipArtifact.tusFiles.length; j++) {
								if (wipArtifact.tusFiles[j]){
									var fname = wipArtifact.tusFiles[j].name;

									if (fname == files[k].fname){
										idsToAdd.push(wipArtifact.tusFiles[j].id);
									}
								}
							}
						}
					}

					PhoenixAPI.pendingUploadQueue[i].ipfsAddStart = true;

					var startIPFSAdd = function(tmpID){
						PhoenixAPI.addFilesToIPFS(idsToAdd, function(ipfsStatus){
							for (var x in PhoenixAPI.pendingUploadQueue){
								if (PhoenixAPI.pendingUploadQueue[x].tmpID === tmpID){
									PhoenixAPI.pendingUploadQueue[x].ipfsStatus = ipfsStatus;
									PhoenixEvents.trigger("onIPFSStart", {});
								}
							}
						});
					}

					startIPFSAdd(PhoenixAPI.pendingUploadQueue[i].tmpID);
						
				} else {
					if (PhoenixAPI.pendingUploadQueue[i].ipfsStatus && PhoenixAPI.pendingUploadQueue[i].ipfsStatus.id){
						PhoenixAPI.checkIPFSaddStatus(PhoenixAPI.pendingUploadQueue[i].ipfsStatus.id, function(data){
							PhoenixEvents.trigger("onIPFSStatus", data);
							for (var item = 0; item < PhoenixAPI.pendingUploadQueue.length; item++){
								if (PhoenixAPI.pendingUploadQueue[item] && PhoenixAPI.pendingUploadQueue[item].ipfsStatus && PhoenixAPI.pendingUploadQueue[item].ipfsStatus.id && PhoenixAPI.pendingUploadQueue[item].ipfsStatus.id === data.id){
									Phoenix.pendingUploadQueue[item].ipfsStatus = data;

									if (Phoenix.pendingUploadQueue[item].ipfsStatus.status === "ipfs_file_check_complete"){
										Phoenix.pendingUploadQueue[item].artifactJSON.artifact.storage.location = Phoenix.pendingUploadQueue[item].ipfsStatus.mainHash;

										var wipArtifact = Phoenix.pendingUploadQueue[item];

										PhoenixAPI.pendingUploadQueue.splice(item, 1);

										wipArtifact.artifactJSON = LibraryDJS.signPublishArtifact(Phoenix.getWallet(), wipArtifact.artifactJSON.artifact.storage.location, Phoenix.currentPublisher.address, wipArtifact.artifactJSON);

										//Publish the artifact JSON into the blockchain.
										Phoenix.addWIPToPublishQueue(wipArtifact);
									}
								}
							}
						})
					}
				}
			}
		}
		
		localStorage.pendingUploadQueue = JSON.stringify(PhoenixAPI.pendingUploadQueue);	
	}

	PhoenixAPI.addAndPublish = function(artifactJSON, callback){
		var publishObject = {
			artifactJSON: artifactJSON,
			tusFiles: [],
			ipfsAddStart: false
		}

		var idsToAdd = [];

		var files = artifactJSON.artifact.storage.files;

		for (var i = 0; i < files.length; i++) {
			if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles){
				for (var j = 0; j < PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.length; j++) {
					if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[j].name == files[i].fname){
						publishObject.tusFiles.push(PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[j]);
					}
				}
			}
		}

		for (var j = 0; j < PhoenixAPI.pendingUploadQueue.length; j++){
			for (var i = 0; i < PhoenixAPI.pendingUploadQueue[j].tusFiles.length; i++) {
				if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i]){
					if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i].name == file.name){
						publishObject.tusFiles.push(PhoenixAPI.pendingUploadQueue[j].tusFiles[i]);
					}
				}
			}
		}

		PhoenixAPI.pendingUploadQueue.push(publishObject);

		// PhoenixAPI.addFilesToIPFS(idsToAdd, function(ipfsData){
		// 	artifactJSON.artifact.storage.location = ipfsData[ipfsData.length - 1].hash;

		// 	// Publish the artifact JSON into the blockchain.
		// 	PhoenixAPI.addToPublishQueue(artifactJSON);
		// });
	}

	PhoenixAPI.addFilesToIPFS = function(idsToAdd, callback){
		$.ajax(PhoenixAPI.tusIPFSEndpoint + "/addToIPFS", {
		    "contentType" : 'application/json',
		    "type" : 'POST',
			"data": JSON.stringify({"fileids": idsToAdd}), 
			"success": function( data ) {
				callback(data);
			}
		});
	}

	PhoenixAPI.checkIPFSaddStatus = function(id, callback){
		try {
			$.ajax(PhoenixAPI.tusIPFSEndpoint + "/check/" + id, {
			    "contentType" : 'application/json',
			    "type" : 'GET',
				"success": function( data ) {
					callback(data);
				}
			});
		} catch (e) {  }
	}

	PhoenixAPI.getPublishersFromLibraryD = function(){
		var wallet = this.wallet;

		try {
			$.getJSON(librarianHost + "/alexandria/v2/publisher/get/all", function( data ) {
				var myPublishers = [];

				for (var i = 0; i < data.length; i++) {
					//console.log(data[i]["publisher-data"]["alexandria-publisher"]);
					for (var addr in wallet.addresses) {
						var walletAddress = wallet.addresses[addr].addr;
						var publisher = data[i]["publisher-data"]["alexandria-publisher"];
						if (publisher.address == walletAddress){
							myPublishers.push(publisher);
						}
					}
				}

				if (myPublishers.length === 0){
					for (var i = 0; i < PhoenixAPI.sentPubUsers.length; i++) {
						for (var addr in wallet.addresses) {
							var walletAddress = wallet.addresses[addr].addr;
							if (PhoenixAPI.sentPubUsers[i].address == walletAddress){
								PhoenixAPI.sentPubUsers[i].name = PhoenixAPI.sentPubUsers[i].username;
								myPublishers.push(PhoenixAPI.sentPubUsers[i]);
							}
						}
					}
				}

				if (myPublishers.length === 0){
					PhoenixEvents.trigger("onPublisherLoadFailure", { message: 'No publishers found in LibraryD that match any wallet addresses.' });
				} else {
					PhoenixAPI.publishers = myPublishers;
					PhoenixEvents.trigger("onPublisherLoadSuccess", PhoenixAPI.publishers);
				}

				for (var pub in myPublishers)
					PhoenixAPI.loadArtifactsForPub(myPublishers[pub].address);
			});
		} catch (e) {
			PhoenixEvents.trigger('onError', {message: e});
		}
	}

	PhoenixAPI.loadArtifactsForPub = function(pubAddress){
		var results = PhoenixAPI.searchAPI('media', 'publisher', pubAddress);

		PhoenixAPI.artifacts[pubAddress] = results;
		PhoenixEvents.trigger('onArtifactsLoad', {address: pubAddress, results: results})
	}

	PhoenixAPI.updateArtifactList = function(){
		if (PhoenixAPI.pendingArtifact){
			PhoenixAPI.loadArtifactsForPub(PhoenixAPI.currentPublisher.address);
		}
	}

	PhoenixAPI.getWallet = function(){
		return this.wallet;
	}

	PhoenixAPI.publishArtifact = function(artifactJSON, callback){
		if (!artifactJSON.artifact.info.year)
			artifactJSON.artifact.info.year = parseInt(new Date().getYear());

		if (typeof artifactJSON.artifact.info.year == "string")
			artifactJSON.artifact.info.year = parseInt(artifactJSON.artifact.info.year);

		PhoenixAPI.calculatePublishFee(artifactJSON, function(usd, pubFee){
			PhoenixEvents.trigger("onPublishStart", "Starting publish attempt");
			LibraryDJS.publishArtifact(PhoenixAPI.wallet, artifactJSON.artifact.storage.location, PhoenixAPI.currentPublisher.address, artifactJSON, pubFee, function(err, data){
				if (err){
					console.log("Error: " + data);
					return;
				}
				callback(data);

				PhoenixEvents.trigger("onPublishEnd", data);		
			});
		})
			
	}

	PhoenixAPI.addBulkToPublishQueue = function(artifactJSON){
		artifactJSON = LibraryDJS.signPublishArtifact(PhoenixAPI.wallet, artifactJSON.artifact.storage.location, PhoenixAPI.currentPublisher.address, artifactJSON);

		PhoenixAPI.addToPublishQueue(artifactJSON);
	}

	PhoenixAPI.addToPublishQueue = function(artJSON){
		PhoenixAPI.publishQueue.push({
			status: "",
			txPushComplete: false,
			txs: [],
			artifactJSON: artJSON
		});
	}

	PhoenixAPI.addWIPToPublishQueue = function(wipJSON){
		PhoenixAPI.publishQueue.push({
			status: "",
			txPushComplete: false,
			txs: [],
			artifactJSON: wipJSON.artifactJSON,
			id: wipJSON.ipfsStatus.id,
			tmpID: wipJSON.tmpID
		});
	}

	PhoenixAPI.processPublishQueue = function(){
		if (PhoenixAPI.publishQueue.length === 0 && PhoenixAPI.publishState === "Ready" && typeof PhoenixAPI.currentArtifactPublish === "object" && PhoenixAPI.currentArtifactPublish.pubFee){
			PhoenixEvents.trigger("onPublishStart", "Starting publish attempt");
			PhoenixAPI.publishState = "Publishing";
		} else if (PhoenixAPI.publishQueue.length > 0 && PhoenixAPI.publishState === "Ready"){
			PhoenixAPI.publishState = "Publishing";

			// Get the first element and remove it from the array
			var pubObj = PhoenixAPI.publishQueue.shift();
			PhoenixAPI.currentArtifactPublish = pubObj;

			PhoenixAPI.currentArtifactPublish.splitStrings = LibraryDJS.createMultipartStrings(JSON.stringify(pubObj.artifactJSON));

			PhoenixAPI.calculatePublishFee(pubObj.artifactJSON, function(usd, pubFee){
				if (isNaN(pubFee)){
					pubFee = 0.002;
				}
				PhoenixAPI.currentArtifactPublish.pubFee = pubFee;
				PhoenixEvents.trigger("onPublishStart", "Starting publish attempt");
			})

			// PhoenixAPI.publishArtifact(pubObj.artifactJSON, function(data){
			// 	PhoenixAPI.publishState = "Ready";
			// 	PhoenixAPI.currentArtifactPublish = undefined;
			// })
		}

		if (PhoenixAPI.publishState === "Publishing"){
			try {
				LibraryDJS.processTXPublishObj(PhoenixAPI.currentArtifactPublish, {
					wallet: PhoenixAPI.wallet,
					address: PhoenixAPI.currentPublisher.address
				}, PhoenixAPI.publishQueueOnTXSuccess, PhoenixAPI.publishQueueOnTXError);
			} catch (e) {
				LibraryDJS.walletStatus = "Idle";
			}
		}

		localStorage.currentArtifactPublish = JSON.stringify(PhoenixAPI.currentArtifactPublish);
		localStorage.publishQueue = JSON.stringify(PhoenixAPI.publishQueue);
	}

	PhoenixAPI.publishQueueOnTXSuccess = function(data){
		PhoenixAPI.currentArtifactPublish.txs.push(data);

		if (PhoenixAPI.currentArtifactPublish.txs && PhoenixAPI.currentArtifactPublish.splitStrings && PhoenixAPI.currentArtifactPublish.txs.length > 0 && PhoenixAPI.currentArtifactPublish.splitStrings.length > 0 && PhoenixAPI.currentArtifactPublish.txs.length === PhoenixAPI.currentArtifactPublish.splitStrings.length){
			PhoenixAPI.publishState = "Ready";

			PhoenixAPI.currentArtifactPublish.publisher = PhoenixAPI.currentPublisher.address;

			PhoenixAPI.publishedArtifacts.push(PhoenixAPI.currentArtifactPublish);
			localStorage.publishedArtifacts = JSON.stringify(PhoenixAPI.publishedArtifacts);

			PhoenixAPI.currentArtifactPublish = undefined;
			PhoenixEvents.trigger("onPublishEnd", data);
		}

		PhoenixEvents.trigger("onPublishTXSuccess", data);
	}

	PhoenixAPI.publishQueueOnTXError = function(error){ }

	PhoenixAPI.getMarketData = function(callback){
		$.getJSON("https://api.alexandria.io/flo-market-data/v1/getAll", function(data){
			PhoenixAPI.marketData = data;
			callback(data);
		})
	}

	PhoenixAPI.deactivateArtifact = function(artifactTxid){
		try {
			swal({   
				animation: true,
				title: "Are you sure?",   
				text: "This will remove it from all OIP Libraries!",   
				type: "warning",
				showCancelButton: true,   
				confirmButtonColor: "#f44336",
				confirmButtonText: "Yes, deactivate it!",   
				closeOnConfirm: false 
			}, function(){   
				var results = PhoenixAPI.searchAPI('media', 'txid', artifactTxid);

				if (!results){
					console.error("ERR: No results from API when trying to Deactivate TXID: " + artifactTxid);
					PhoenixEvents.trigger('onArtifactDeactivateFail', "ERR: No results from API when trying to Deactivate TXID: " + artifactTxid);
					return;
				}

				var artPublisher;
				if (results[0]["media-data"]){
					artPublisher = results[0]["media-data"]["alexandria-media"].publisher;
				} else if (results[0]["oip-041"]){
					artPublisher = results[0].publisher;
				}

				LibraryDJS.sendDeactivationMessage(PhoenixAPI.wallet, artPublisher, artifactTxid, function(error, response){
					if (error) {
						PhoenixEvents.trigger('onArtifactDeactivateFail', error);
						return;
					}

					PhoenixAPI.disabledArtifactTXIDs.push(artifactTxid);
					localStorage.disabledArtifactTXIDs = JSON.stringify(PhoenixAPI.disabledArtifactTXIDs);

					PhoenixEvents.trigger('onArtifactDeactivateSuccess', response, artifactTxid);
				});
			});
		} catch (e) {
			console.log(e);
			// Most likely an issue with Sweet alert, abort for now.
		}
	}	

	PhoenixAPI.viewArtifact = function(txid){
		document.location.href = PhoenixAPI.browserURL + txid.substring(0, 6);
	}

	PhoenixAPI.calculatePublishFee = function(artJSON, callback){
		PhoenixAPI.updateMarketData(function(marketData){
			PhoenixAPI.updateLibrarydInfoData(function(libraryDData){
				var USDperFLO = marketData.USD;
				var floPerKb = 0.01; // new endpoint, using 0.1 as default for now, ToDo: Update this when changes are made!
				var pubFeeFreeFlo = (JSON.stringify(artJSON).length / 1024) * floPerKb;
				var pubFeeFreeUSD = pubFeeFreeFlo * USDperFLO;

				var minPlayArray = [], minBuyArray = [], sugPlayArray = [], sugBuyArray = [];

				if (artJSON.artifact && artJSON.artifact.storage && artJSON.artifact.storage.files){
					var files = artJSON.artifact.storage.files;

					for (var i = 0; i < files.length; i++) {
						if (!artJSON.artifact.payment)
							artJSON.artifact.payment = {}

						if (artJSON.artifact && artJSON.artifact.payment && !artJSON.artifact.payment.disPer)
							artJSON.artifact.payment.disPer == 0.30;

						if (files[i].sugBuy){
							// disPer stands for discount percentage
							minBuyArray.push(parseFloat(files[i].sugBuy) * (1-artJSON.artifact.payment.disPer))
							sugBuyArray.push(parseFloat(files[i].sugBuy))
						}
						if (files[i].sugPlay){
							minPlayArray.push(parseFloat(files[i].sugPlay) * (1-artJSON.artifact.payment.disPer))
							sugPlayArray.push(parseFloat(files[i].sugPlay))
						}
					}
				}		

				var totMinPlay = 0;
				for (var i = 0; i < minPlayArray.length; i++) {
					totMinPlay += minPlayArray[i];
				}

				var totMinBuy = 0;
				for (var i = 0; i < minBuyArray.length; i++) {
					totMinBuy += minBuyArray[i];
				}

				var totSugPlay = 0;
				for (var i = 0; i < sugPlayArray.length; i++) {
					totSugPlay += sugPlayArray[i];
				}

				var totSugBuy = 0;
				for (var i = 0; i < sugBuyArray.length; i++) {
					totSugBuy += sugBuyArray[i];
				}

				var artCost = (totMinPlay + totSugPlay + totMinBuy + totSugBuy) / 4; // divide by 4 because there are four inputs

				var avgArtCost = libraryDData.avgArtCost;

				var pubFeeComUSD = 0;
				if (artCost <= avgArtCost){
					pubFeeComUSD = artCost;
				} else {
					pubFeeComUSD = (( Math.log(artCost) - Math.log(avgArtCost) ) * (avgArtCost / artCost) * (artCost - avgArtCost)) + avgArtCost;
				}

				var pubFeeComFlo = pubFeeComUSD / USDperFLO;
				var pubFeeUSD = Math.max(pubFeeFreeUSD, pubFeeComUSD);
				var pubFeeFlo = pubFeeUSD / USDperFLO;

				callback(pubFeeUSD, pubFeeFlo);
			})
		})
				
	}

	PhoenixAPI.updateMarketData = function(callback){
		if (!callback)
			callback = function(){};

		var timeNow = Date.now();
		var yesterday = timeNow - (24*60*60*1000);
		if (PhoenixAPI.marketData && PhoenixAPI.marketData.timestamp > yesterday){
			callback(PhoenixAPI.marketData.data);
		} else {
			$.getJSON(librarianHost + "/flo-market-data/v1/getAll", function( data ) {
				PhoenixAPI.marketData.timestamp = Date.now();
				PhoenixAPI.marketData.data = data;

				callback(data);
			});
		}		
	}

	PhoenixAPI.updateLibrarydInfoData = function(callback){
		// ToDo: this

		if (!callback)
			callback = function(){};

		var timeNow = Date.now();
		var yesterday = timeNow - (24*60*60*1000);
		if (PhoenixAPI.librarydInfo && PhoenixAPI.librarydInfo.timestamp > yesterday){
			callback(PhoenixAPI.librarydInfo.data);
		} else {
			$.getJSON(librarianHost + "/alexandria/v2/info", function( data ) {
				PhoenixAPI.librarydInfo.timestamp = Date.now();
				PhoenixAPI.librarydInfo.data = data;

				callback(data);
			});
		}
	}

	PhoenixAPI.removeTusInfo = function(filename){
		if (PhoenixAPI.wipArtifacts && PhoenixAPI.currentWIPID){
			for (var i = 0; i < PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.length; i++) {
				if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i]){
					if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].name === filename){
						var tmpTus = PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles;
						delete tmpTus[i];
						PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles = JSON.parse(JSON.stringify(tmpTus));
						PhoenixAPI.saveWIPArtifacts();
					}
				}
			}
		}
		
		for (var j = 0; j < PhoenixAPI.pendingUploadQueue.length; j++){
			for (var i = 0; i < PhoenixAPI.pendingUploadQueue[j].tusFiles.length; i++) {
				if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i] && PhoenixAPI.pendingUploadQueue[j].tusFiles[i].name == filename){
					var tmpTus = PhoenixAPI.pendingUploadQueue[j].tusFiles;
					delete tmpTus[i];
					PhoenixAPI.pendingUploadQueue[j].tusFiles = JSON.parse(JSON.stringify(tmpTus));
				}
	    	}
		}
	}

	PhoenixAPI.uploadFileToTus = function(file, onSuccess, onError, onProgress, newName, saveToBulk){
		if (!onSuccess)
			onSuccess = function(){};
		if (!onError)
			onError = function(){};
		if (!onProgress)
			onProgress = function(){};

		if (!PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID]){
			var obj = {"name": newName ? newName : file.name, size: file.size};
			if (newName)
				obj.oldName = file.name;

			PhoenixAPI.bulkTusFiles.push(obj);
		} else {
			if (!PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles)
				PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles = [];

			var inFiles = false;
			for (var i = 0; i < PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.length; i++) {
				if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i]){
					if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].name === file.name || PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].name === newName){
						inFiles = true;
					}
				}
			}

			if (!inFiles)
				PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.push({"name": newName ? newName : file.name, size: file.size});
		}
			
		PhoenixAPI.saveWIPArtifacts();

		// Create a new tus upload
	    var upload = new tus.Upload(file, {
	    	metadata: {
	    		"name": newName ? newName : file.name
	    	},
	        endpoint: PhoenixAPI.tusIPFSEndpoint + "/files/",
	        retryDelays: [0, 1000, 3000, 5000],
	        onError: function(error) {
	        	 if (PhoenixAPI.wipArtifacts && PhoenixAPI.currentWIPID){
	        		for (var i = 0; i < PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.length; i++) {
						if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i] && PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].name == file.name){
							PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].error = error;
							PhoenixAPI.saveWIPArtifacts();
						}
					}
	        	}
				
				for (var j = 0; j < PhoenixAPI.pendingUploadQueue.length; j++){
					for (var i = 0; i < PhoenixAPI.pendingUploadQueue[j].tusFiles.length; i++) {
						var fname = PhoenixAPI.pendingUploadQueue[j].tusFiles[i].name;

						if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i].oldName)
							fname = PhoenixAPI.pendingUploadQueue[j].tusFiles[i].oldName;

						if (fname == file.name){
							PhoenixAPI.pendingUploadQueue[j].tusFiles[i].error = error;
						}
		        	}
				}

				for (var i = 0; i < PhoenixAPI.bulkTusFiles.length; i++) {
					if (PhoenixAPI.bulkTusFiles[i]){
						var fname = PhoenixAPI.bulkTusFiles[i].name;

						if (PhoenixAPI.bulkTusFiles[i].oldName)
							fname = PhoenixAPI.bulkTusFiles[i].oldName;

						if (fname == file.name){
							PhoenixAPI.bulkTusFiles[i].error = error;
						}
					}
				}

				PhoenixEvents.trigger('onTusUploadError', {});

	            onError(error);
	        },
	        onProgress: function(bytesUploaded, bytesTotal) {
	            var percentage = (bytesUploaded / bytesTotal * 100).toFixed(2);

	            if (PhoenixAPI.wipArtifacts && PhoenixAPI.currentWIPID){
	        		for (var i = 0; i < PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.length; i++) {
	        			if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i]){
	        				if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].name == file.name){
								PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].progress = percentage;
								PhoenixAPI.saveWIPArtifacts();
							}
	        			}
					}
	        	}
				
				for (var j = 0; j < PhoenixAPI.pendingUploadQueue.length; j++){
					for (var i = 0; i < PhoenixAPI.pendingUploadQueue[j].tusFiles.length; i++) {
						if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i]){
							var fname = PhoenixAPI.pendingUploadQueue[j].tusFiles[i].name;
						
							if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i].oldName)
								fname = PhoenixAPI.pendingUploadQueue[j].tusFiles[i].oldName;

							if (fname == file.name){
								PhoenixAPI.pendingUploadQueue[j].tusFiles[i].progress = percentage;
							}
						}
		        	}
				}

				for (var i = 0; i < PhoenixAPI.bulkTusFiles.length; i++) {
					if (PhoenixAPI.bulkTusFiles[i]){
						var fname = PhoenixAPI.bulkTusFiles[i].name;
						
						if (PhoenixAPI.bulkTusFiles[i].oldName)
							fname = PhoenixAPI.bulkTusFiles[i].oldName;

						if (fname == file.name){
							PhoenixAPI.bulkTusFiles[i].progress = percentage;
						}
					}
				}

				PhoenixEvents.trigger('onTusUploadProgress', {});

	            onProgress(percentage, bytesUploaded, bytesTotal);
	        },
	        onSuccess: function() {
	        	var id = upload.url.replace(PhoenixAPI.tusIPFSEndpoint + '/files/', '');

	        	if (PhoenixAPI.wipArtifacts && PhoenixAPI.currentWIPID){
	        		for (var i = 0; i < PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles.length; i++) {
	        			if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i]){
	        				if (PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].name == file.name){
								PhoenixAPI.wipArtifacts[PhoenixAPI.currentWIPID].tusFiles[i].id = id;
								PhoenixAPI.saveWIPArtifacts();
							}
	        			}
					}
	        	}
				
				for (var j = 0; j < PhoenixAPI.pendingUploadQueue.length; j++){
					for (var i = 0; i < PhoenixAPI.pendingUploadQueue[j].tusFiles.length; i++) {
						if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i]){
							var fname = PhoenixAPI.pendingUploadQueue[j].tusFiles[i].name;
						
							if (PhoenixAPI.pendingUploadQueue[j].tusFiles[i].oldName)
								fname = PhoenixAPI.pendingUploadQueue[j].tusFiles[i].oldName;

							if (fname == file.name){
								PhoenixAPI.pendingUploadQueue[j].tusFiles[i].id = id;
							}
						}
					}
				}

				for (var i = 0; i < PhoenixAPI.bulkTusFiles.length; i++) {
					if (PhoenixAPI.bulkTusFiles[i]){
						var fname = PhoenixAPI.bulkTusFiles[i].name;
						
						if (PhoenixAPI.bulkTusFiles[i].oldName)
							fname = PhoenixAPI.bulkTusFiles[i].oldName;

						if (fname == file.name){
							PhoenixAPI.bulkTusFiles[i].id = id;
						}
					}
				}

				PhoenixEvents.trigger("onTusUploadSuccess", {});

	        	onSuccess(id);
	        }
	    })

	    // Start the upload
	    upload.start()
	}

	return PhoenixAPI;
})();