// 1. Initialize Map Engine
const map = L.map('map', { 
  zoomControl: false, 
  maxZoom: 20, 
  minZoom: 3 
}).setView([20, 0], 16);

// Position Zoom Controls at Bottom-Left to avoid right-hand action buttons
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// 2. Tile Layers Configuration
const esriLightMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, 
  maxNativeZoom: 18,
  attribution: 'Tiles &copy; Esri'
}).addTo(map);

const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, 
  maxNativeZoom: 18, 
  attribution: 'Tiles &copy; Esri'
});

const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20, 
  maxNativeZoom: 19, 
  attribution: '&copy; OpenStreetMap'
});

const baseMaps = {
  "Google Style": esriLightMap,
  "Satellite": esriSatellite,
  "Street View": openStreetMap
};
L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

// Global State Variables
let userLat = null, userLng = null;
let destLat = null, destLng = null;
let currentSpeed = 40;
let currentMode = "Car";
let routingControl = null;
let userMarker = null;
let destMarker = null;
let accuracyCircle = null;
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

// Set Dynamic Turn Icon for HUD
function setHudIcon(type) {
  const iconElement = document.getElementById('hud-icon');
  if (!iconElement) return;

  let iconClass = "fa-solid fa-arrow-up";
  if (type && type.includes("Left")) iconClass = "fa-solid fa-arrow-turn-up fa-flip-horizontal";
  else if (type && type.includes("Right")) iconClass = "fa-solid fa-diamond-turn-right";
  else if (type && type.includes("Uturn")) iconClass = "fa-solid fa-rotate-left";

  iconElement.innerHTML = `<i class="${iconClass}"></i>`;
}

// 4. Reverse Geocoding Address Lookup
async function updateAddressDisplay(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`, {
      headers: { 'Accept-Language': 'en' }
    });
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

// Set/Update Destination Marker with Dragging Support
function setDestination(lat, lng, label = "Selected Destination") {
  destLat = lat;
  destLng = lng;

  if (destMarker) {
    destMarker.setLatLng([destLat, destLng]);
    destMarker.getPopup().setContent(label);
  } else {
    destMarker = L.marker([destLat, destLng], { draggable: true }).addTo(map).bindPopup(label);
    
    destMarker.on('dragend', function(e) {
      const newPos = e.target.getLatLng();
      destLat = newPos.lat;
      destLng = newPos.lng;
      if (userLat && userLng) calculateRoute();
    });
  }

  destMarker.openPopup();
  if (userLat && userLng) calculateRoute();
}

// 5. Route Calculation & Navigation Sync
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

    const routeCard = document.getElementById('route-card');
    if (routeCard) routeCard.style.display = 'block';
    
    document.getElementById('route-mode-title').innerText = `${currentMode} Navigation`;
    document.getElementById('route-dist').innerText = `${distanceKm} km`;
    document.getElementById('route-time').innerText = timeMins > 60 
      ? `${Math.floor(timeMins/60)}h ${timeMins%60}m` 
      : `${timeMins} mins`;

    if (route.instructions && route.instructions.length > 0) {
      const firstStep = route.instructions[0];
      const roadName = firstStep.road ? firstStep.road : "the main road";
      const nextInstruction = firstStep.text;

      setHudIcon(firstStep.type);

      const voiceHud = document.getElementById('voice-hud');
      if (voiceHud) voiceHud.style.display = 'flex';
      
      const hudInstruction = document.getElementById('hud-instruction');
      if (hudInstruction) hudInstruction.innerText = nextInstruction;
      
      const audioPrompt = `Starting ${currentMode} route. Head towards ${roadName}. Distance is ${distanceKm} kilometers. ${nextInstruction}`;
      speakInstruction(audioPrompt);
    }

    const bounds = L.latLngBounds([userLat, userLng], [destLat, destLng]);
    map.fitBounds(bounds, { padding: [50, 50] });
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

// 7. Custom Search API Integration
let searchTimeout = null;
const searchInput = document.getElementById('custom-search-input');
const resultsList = document.getElementById('search-results-list');
const searchSpinner = document.getElementById('search-spinner');

if (searchInput) {
  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const firstResult = resultsList.querySelector('li');
      if (firstResult) firstResult.click();
    }
  });

  searchInput.addEventListener('input', function(e) {
    const query = e.target.value.trim();
    clearTimeout(searchTimeout);
    resultsList.innerHTML = '';
    
    if (query.length < 3) {
      if (searchSpinner) searchSpinner.style.display = 'none';
      return;
    }

    if (searchSpinner) searchSpinner.style.display = 'block';

    searchTimeout = setTimeout(async () => {
      try {
        const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
        const data = await response.json();
        
        if (searchSpinner) searchSpinner.style.display = 'none';
        resultsList.innerHTML = '';

        if (data && data.features && data.features.length > 0) {
          data.features.forEach(feature => {
            const props = feature.properties;
            const coords = feature.geometry.coordinates;
            
            const label = [props.name, props.city || props.town || props.state, props.country].filter(Boolean).join(', ');

            const li = document.createElement('li');
            li.textContent = label || "Selected Place";
            
            li.addEventListener('click', () => {
              setDestination(coords[1], coords[0], label);
              searchInput.value = label;
              resultsList.innerHTML = '';
            });
            
            resultsList.appendChild(li);
          });
        }
      } catch (err) {
        console.error('Search error:', err);
        if (searchSpinner) searchSpinner.style.display = 'none';
      }
    }, 350);
  });
}

// Map Click Handler to manual select destination
map.on('click', function(e) {
  setDestination(e.latlng.lat, e.latlng.lng, "Custom Destination");
});

// 8. Live GPS Tracking
function trackPosition() {
  if (!("geolocation" in navigator)) return;

  navigator.geolocation.watchPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      if (!userMarker) {
        userMarker = L.marker([userLat, userLng], { icon: userIcon }).addTo(map).bindPopup("You are here");
        accuracyCircle = L.circle([userLat, userLng], { radius: accuracy, color: '#2563eb', weight: 1, opacity: 0.4 }).addTo(map);
        map.flyTo([userLat, userLng], 16);
      } else {
        userMarker.setLatLng([userLat, userLng]);
        if (accuracyCircle) {
          accuracyCircle.setLatLng([userLat, userLng]).setRadius(accuracy);
        }
      }

      updateAddressDisplay(userLat, userLng);
    },
    (err) => console.warn("GPS Warning:", err.message),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

// Button Control Event Listeners
const voiceBtn = document.getElementById('voice-toggle-btn');
if (voiceBtn) {
  voiceBtn.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    voiceBtn.innerHTML = voiceEnabled 
      ? '<i class="fa-solid fa-volume-high"></i>' 
      : '<i class="fa-solid fa-volume-xmark"></i>';
  });
}

const recenterBtn = document.getElementById('recenter-btn');
if (recenterBtn) {
  recenterBtn.addEventListener('click', () => {
    if (userLat && userLng) map.flyTo([userLat, userLng], 16);
  });
}

const compassBtn = document.getElementById('compass-btn');
if (compassBtn) {
  compassBtn.addEventListener('click', () => {
    map.setView(map.getCenter(), map.getZoom());
  });
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('Service Worker Registered'))
    .catch((err) => console.log('Service Worker Failed:', err));
}

trackPosition();

// PWA INSTALL PROMPT LOGIC
let deferredPrompt = null;
const installBtn = document.getElementById('pwa-install-btn');
const pwaBanner = document.getElementById('pwa-banner');
const pwaCloseBtn = document.getElementById('pwa-close-btn');

if (window.matchMedia('(display-mode: standalone)').matches) {
  if (pwaBanner) pwaBanner.style.display = 'none';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (pwaBanner) pwaBanner.style.display = 'flex';
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        if (pwaBanner) pwaBanner.style.display = 'none';
      }
      deferredPrompt = null;
    }
  });
}

if (pwaCloseBtn) {
  pwaCloseBtn.addEventListener('click', () => {
    if (pwaBanner) pwaBanner.style.display = 'none';
  });
}