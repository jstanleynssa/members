// pages/api/zip-coords.js
// Lightweight server-side ZIP-to-coordinates lookup.
// Used by PartnerNetwork component to geocode the member's own ZIP for distance calc.
// GET /api/zip-coords?zip=33601

const { getZipCoords } = require('../../lib/zipcodes')

export default function handler(req, res) {
  const { zip } = req.query
  if (!zip) return res.status(400).json({ error: 'zip is required' })

  const coords = getZipCoords(String(zip))
  return res.status(200).json({ coords: coords ? { lat: coords.lat, lng: coords.lng } : null })
}
