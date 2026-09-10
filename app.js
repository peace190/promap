// 1. Initialize Leaflet Engine (Max Zoom Capped at 18)
const map = L.map('map', { 
  zoomControl: false, 
  maxZoom: 18, 
  minZoom: 3 
}).setView([20, 0], 2);

L.control.zoom({ position: 'topleft' }).addTo(map);

// 2. Tile Layers (Max Zoom set to 18)
const esriLightMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 18, 
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 18, 
  maxNativeZoom: 18, 
  attribution: 'Tiles &copy; Esri'
});

const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18, 
  maxNativeZoom: 18, 
  attribution: '&copy; OpenStreetMap'
});

const baseMaps = {
  "Google Style": esriLightMap,
  "Satellite": esriSatellite,
  "Street View": openStreetMap
};
L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

// Global Variables
let userLat = null, userLng = null;
let destLat = null, destLng = null;
let currentSpeed = 40;
let currentMode = "Car";
let routingControl = null;
let userMarker = null;
let voiceEnabled = true;

const userIcon = L.divIcon({
  className: 'user-location-marker',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

// 3. Text-To-Speech Synthesizer
function speakInstruction(text) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  utterance.lang = 'en-US';

  window.speechSynthesis.speak(utterance);
}

// 4. Reverse Geocoding Address Lookup
async function updateAddressDisplay(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`);
    const data = await res.json();
    const addr = data.address || {};

    const street = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || "Street Identified";
    const town = addr.city || addr.town || addr.village || addr.county || "Local Hub";
    const state = addr.state || addr.region || "";

    document.getElementById('street-name').innerText = street;
    document.getElementById('area-name').innerText = state ? `${town}, ${state}` : town;
  } catch (err) {
    document.getElementById('street-name').innerText = "Current Location";
    document.getElementById('area-name').innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// 5. Route Calculation & Voice Navigation Sync
function calculateRoute() {
  if (!userLat || !userLng || !destLat || !destLng) return;

  if (routingControl) map.removeControl(routingControl);

  routingControl = L.Routing.control({
    waypoints: [L.latLng(userLat, userLng), L.latLng(destLat, destLng)],
    addWaypoints: false,
    show: false,
    lineOptions: { styles: [{ color: '#2563eb', weight: 6, opacity: 0.8 }] }
  }).addTo(map);

  routingControl.on('routesfound', function(e) {
    const route = e.routes[0];
    const distanceKm = (route.summary.totalDistance / 1000).toFixed(2);
    const timeHours = distanceKm / currentSpeed;
    const timeMins = Math.round(timeHours * 60);

    // Update Bottom Summary Card
    document.getElementById('route-card').style.display = 'block';
    document.getElementById('route-mode-title').innerText = `${currentMode} Navigation`;
    document.getElementById('route-dist').innerText = `${distanceKm} km`;
    document.getElementById('route-time').innerText = timeMins > 60 
      ? `${Math.floor(timeMins/60)}h ${timeMins%60}m` 
      : `${timeMins} mins`;

    // Process Voice Prompt
    if (route.instructions && route.instructions.length > 0) {
      const firstStep = route.instructions[0];
      const roadName = firstStep.road ? firstStep.road : "the main road";
      const nextInstruction = firstStep.text;

      document.getElementById('voice-hud').style.display = 'flex';
      document.getElementById('hud-instruction').innerText = nextInstruction;
      
      const audioPrompt = `Starting ${currentMode} route. Head towards ${roadName}. Distance is ${distanceKm} kilometers. ${nextInstruction}`;
      speakInstruction(audioPrompt);
    }
  });
}

// 6. Transport Mode Listeners
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    
    currentSpeed = parseFloat(this.getAttribute('data-speed'));
    currentMode = this.getAttribute('data-mode');
    
    if (destLat && destLng) calculateRoute();
  });
});

// 7. Search Bar Integration
const geocoder = L.Control.geocoder({
  defaultMarkGeocode: false,
  placeholder: "Search destination..."
})
.on('markgeocode', function(e) {
  destLat = e.geocode.center.lat;
  destLng = e.geocode.center.lng;
  calculateRoute();
})
.addTo(map);

map.on('click', function(e) {
  if (userLat && userLng) {
    destLat = e.latlng.lat;
    destLng = e.latlng.lng;
    calculateRoute();
  }
});

// 8. Continuous Position Tracking
function trackPosition() {
  if (!("geolocation" in navigator)) return;

  navigator.geolocation.watchPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;

      if (!userMarker) {
        userMarker = L.marker([userLat, userLng], { icon: userIcon }).addTo(map);
        map.flyTo([userLat, userLng], 17);
      } else {
        userMarker.setLatLng([userLat, userLng]);
      }

      updateAddressDisplay(userLat, userLng);
    },
    (err) => console.warn(err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

// Controls
document.getElementById('voice-toggle-btn').addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  document.getElementById('voice-toggle-btn').innerHTML = voiceEnabled 
    ? '<i class="fa-solid fa-volume-high"></i>' 
    : '<i class="fa-solid fa-volume-xmark"></i>';
});

document.getElementById('recenter-btn').addEventListener('click', () => {
  if (userLat && userLng) map.flyTo([userLat, userLng], 17);
});

document.getElementById('compass-btn').addEventListener('click', () => {
  map.setView(map.getCenter(), map.getZoom());
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('Service Worker Registered'))
    .catch((err) => console.log('Service Worker Failed:', err));
}

// Mobile Lock Screen & Status Bar Integration
function updatePhoneNotificationBar(instruction, street) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: instruction,
      artist: `Navigating on ${street}`,
      album: 'Pro Navigation Live',
      artwork: [
        { src: 'https://cdn-icons-png.flaticon.com/512/854/854878.png', sizes: '512x512', type: 'image/png' }
      ]
    });
  }
}

trackPosition();