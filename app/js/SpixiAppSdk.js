// Copyright (C) 2025 IXI Labs
// This file is part of Ixian Core - https://github.com/ixian-platform/Spixi-Mini-Apps
//
// Ixian Core is free software: you can redistribute it and/or modify
// it under the terms of the MIT License as published
// by the Open Source Initiative.
//
// Ixian Core is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// MIT License for more details.

// Spixi Mini Mini Apps SDK

var SpixiAppSdk = {
    version: 0.3,
    date: "2025-07-31",
    fireOnLoad: function () { try { location.href = "ixian:onload"; } catch (e) { console.log("SpixiAppSdk.fireOnLoad not in Spixi environment."); } },
    back: function () { location.href = "ixian:back"; },
    sendNetworkData: function (data) { location.href = "ixian:data" + encodeURIComponent(data); },
    sendNetworkProtocolData: function (protocolId, data) { location.href = "ixian:protocolData" + protocolId + "=" + encodeURIComponent(data); },
    getStorageData: function (key) { location.href = "ixian:getStorageData" + encodeURIComponent(key); },
    setStorageData: function (key, value) { location.href = "ixian:setStorageData" + encodeURIComponent(key) + "=" + encodeURIComponent(value); },
    spixiAction: function (actionData) { location.href = "ixian:action" + encodeURIComponent(actionData); },

    // on* handlers should be overriden by the app
    onInit: function (sessionId, userAddresses) { /*console.log("Received init with sessionId: " + sessionId + " and userAddresses: " + userAddresses);*/ },
    onStorageData: function (key, value) { /*console.log("Received storage data: " + key + "=" + value);*/ },
    onNetworkData: function (senderAddress, data) { /*console.log("Received network data from " + senderAddress + ": " + data);*/ },
    onNetworkProtocolData: function (senderAddress, protocolId, data) { /*console.log("Received network app protocol data from " + senderAddress + " - " + protocolId + ": " + data);*/ },
    onRequestAccept: function (data) { /*console.log("Received request accept: " + data);*/ },
    onRequestReject: function (data) { /*console.log("Received request reject: " + data);*/ },
    onAppEndSession: function (data) { /*console.log("Received app end session: " + data);*/ },
};

// Test environment detection
if (window.location.protocol !== "file:") {
    console.log("SpixiAppSdk: Test environment detected.");

    SpixiAppSdk.fireOnLoad = function () {
        console.log("SpixiAppSdk.fireOnLoad called in test mode.");
        // Automatically trigger onInit for testing purposes
        setTimeout(() => SpixiAppSdk.onInit("test-session-id", "test-user-address1,test-user-address2"), 100);
    };

    SpixiAppSdk.back = function() { console.log("SpixiAppSdk.back called."); };

    // Loop back network data to simulate receiving it from a peer
    SpixiAppSdk.sendNetworkData = function (data) {
        console.log("SpixiAppSdk.sendNetworkData (test mode loopback):", data.length, "bytes");
        setTimeout(() => SpixiAppSdk.onNetworkData("test-peer-address", data), 50); // Simulate network delay
    };

    SpixiAppSdk.sendNetworkProtocolData = function (protocolId, data) {
        console.log(`SpixiAppSdk.sendNetworkProtocolData (test mode loopback): ${protocolId}`, data);
        setTimeout(() => SpixiAppSdk.onNetworkProtocolData("test-peer-address", protocolId, data), 50);
    };
    
    SpixiAppSdk.getStorageData = function(key) { console.log(`SpixiAppSdk.getStorageData for key: ${key}`); };
    SpixiAppSdk.setStorageData = function(key, value) { console.log(`SpixiAppSdk.setStorageData for key: ${key} with value: ${value}`); };
    SpixiAppSdk.spixiAction = function(actionData) { console.log(`SpixiAppSdk.spixiAction with data: ${actionData}`); };
}
