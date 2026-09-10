// lib/zipcodes.js
// Server-side ZIP-to-coordinates lookup for the members portal.
// Uses the same zip-centroids.json already bundled in arpi-website.
// If that file isn't available locally, falls back gracefully.
//
// CommonJS module — Pages Router compatible.

const path = require('path')
const fs = require('fs')

let zipCentroids = null

function loadData() {
  if (zipCentroids) return zipCentroids
  // Try to load from arpi-website's dataset (symlinked or referenced)
  const candidates = [
    path.join(__dirname, '../lib/zip-centroids.json'),
    path.join(__dirname, 'zip-centroids.json'),
    path.join(process.cwd(), 'lib/zip-centroids.json'),
    path.join(process.cwd(), '../arpi-website/lib/zip-centroids.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      zipCentroids = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      return zipCentroids
    }
  }
  zipCentroids = {}
  return zipCentroids
}

/**
 * Look up coordinates for a US ZIP code.
 * @param {string} zip
 * @returns {{ lat: number, lng: number, city: string, state: string } | null}
 */
function getZipCoords(zip) {
  if (!zip) return null
  const m = String(zip).match(/\d+/)
  if (!m) return null
  const z = m[0].slice(0, 5).padStart(5, '0')
  const data = loadData()
  const hit = data[z]
  if (!hit) return null
  return { lat: hit[0], lng: hit[1], city: '', state: '' }
}

/**
 * Haversine distance in miles between two { lat, lng } points.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number}
 */
function milesBetween(a, b) {
  if (!a || !b) return Infinity
  const toRad = (d) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

module.exports = { getZipCoords, milesBetween }
