import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState, useMemo } from 'react'
import Link from 'next/link'

const NSSA = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }
const GRAY = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const selectedYear = parseInt(context.query.year) || new Date().getFullYear()

  // Fetch all certified members in batches (bypass 1000 row limit)
  let allMembers = []
  let from = 0
  while (true) {
    const { data, error: fetchError } = await supabaseAdmin
      .from('members')
      .select('email, first_name, last_name, nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, is_active, state, company')
      .or('nssa_certified.eq.true,irmaa_certified.eq.true')
      .order('last_name', { ascending: true })
      .range(from, from + 999)
    if (fetchError) { console.error('Members fetch error:', fetchError.message); break }
    if (!data || data.length === 0) break
    allMembers = allMembers.concat(data)
    if (data.length < 1000) break
    from += 1000
  }
  const members = allMembers

  // Fetch CE hours aggregated by email for selected year
  const { data: ceData } = await supabaseAdmin
    .from('ce_submissions')
    .select('email, designation, hours_earned, completion_date')
    .eq('status', 'approved')
    .eq('year', selectedYear)

  // Build hours lookup
  const hoursMap = {}
  for (const sub of (ceData || [])) {
    if (!hoursMap[sub.email]) hoursMap[sub.email] = { nssa: 0, irmaa: 0, lastDate: null }
    const h = Number(sub.hours_earned)
    if (sub.designation === 'NSSA' || sub.designation === 'both') hoursMap[sub.email].nssa += h
    if (sub.designation === 'IRMAA' || sub.designation === 'both') hoursMap[sub.email].irmaa += h
    if (!hoursMap[sub.email].lastDate || sub.completion_date > hoursMap[sub.email].lastDate) {
      hoursMap[sub.email].lastDate = sub.completion_date
    }
  }

  const certYear = (dateStr) => dateStr ? new Date(dateStr).getFullYear() : null

  const rows = members.map(m => {
    const ce = hoursMap[m.email] || { nssa: 0, irmaa: 0, lastDate: null }
    const nssaExempt = certYear(m.nssa_cert_date) === selectedYear
    const irmaaExempt = certYear(m.irmaa_cert_date) === selectedYear

    const nssaStatus = !m.nssa_certified ? 'na'
      : nssaExempt ? 'exempt'
      : ce.nssa >= 4 ? 'met'
      : ce.nssa > 0 ? 'progress'
      : 'unstarted'

    const irmaaStatus = !m.irmaa_certified ? 'na'
      : irmaaExempt ? 'exempt'
      : ce.irmaa >= 4 ? 'met'
      : ce.irmaa > 0 ? 'progress'
      : 'unstarted'

    return {
      email: m.email,
      firstName: m.first_name || '',
      lastName: m.last_name || '',
      nssaCertified: !!m.nssa_certified,
      irmaaCertified: !!m.irmaa_certified,
      isActive: m.is_active !== false,
      state: m.state || '',
      company: m.company || '',
      nssaHours: ce.nssa,
      irmaaHours: ce.irmaa,
      nssaStatus,
      irmaaStatus,
      lastDate: ce.lastDate,
    }
  })

  // Available years
  const { data: yearData } = await supabaseAdmin
    .from('ce_submissions')
    .select('year')
  const years = [...new Set((yearData || []).map(r => r.year).filter(Boolean))].sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  if (!years.includes(currentYear)) years.unshift(currentYear)

  return {
    props: { rows, selectedYear, availableYears: years, currentYear }
  }
}

function StatusPill({ status, hours }) {
  const styles = {
    met:       { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: '✓ Met' },
    exempt:    { bg: '#eff6ff', color: NSSA.medium, border: NSSA.light, label: '✓ Exempt' },
    progress:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a', label: `${hours}/4 hrs` },
    unstarted: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: '0 / 4 hrs' },
    na:        { bg: GRAY.bg,   color: GRAY.text,  border: GRAY.border, label: '—' },
  }
  const s = styles[status] || styles.na
  return (
    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '8px', padding: '1rem' }}>
      <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: '24px', fontWeight: 700, color: color || '#111' }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '2px' }}>{sub}</p>}
    </div>
  )
}

function pct(num, den) {
  if (!den) return '—'
  return Math.round((num / den) * 100) + '%'
}

export default function AdminMembers({ rows, selectedYear, availableYears, currentYear }) {
  const [search, setSearch] = useState('')
  const [designFilter, setDesignFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('active')
  const [sortCol, setSortCol] = useState('lastName')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(1)
  }

  const filtered = useMemo(() => {
    let list = [...rows]

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.firstName.toLowerCase().includes(q) ||
        r.lastName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q)
      )
    }

    if (activeFilter === 'active') list = list.filter(r => r.isActive)
    if (activeFilter === 'inactive') list = list.filter(r => !r.isActive)

    if (designFilter === 'nssa') list = list.filter(r => r.nssaCertified)
    if (designFilter === 'irmaa') list = list.filter(r => r.irmaaCertified)

    if (statusFilter !== 'all') {
      list = list.filter(r => {
        if (designFilter === 'nssa') return r.nssaStatus === statusFilter
        if (designFilter === 'irmaa') return r.irmaaStatus === statusFilter
        const statuses = [
          r.nssaCertified ? r.nssaStatus : null,
          r.irmaaCertified ? r.irmaaStatus : null
        ].filter(Boolean)
        return statuses.includes(statusFilter)
      })
    }

    list.sort((a, b) => {
      let av, bv
      if (sortCol === 'lastName')    { av = a.lastName.toLowerCase();  bv = b.lastName.toLowerCase() }
      else if (sortCol === 'nssaHours')  { av = a.nssaHours;  bv = b.nssaHours }
      else if (sortCol === 'irmaaHours') { av = a.irmaaHours; bv = b.irmaaHours }
      else if (sortCol === 'lastDate')   { av = a.lastDate || ''; bv = b.lastDate || '' }
      else if (sortCol === 'state')      { av = a.state.toLowerCase(); bv = b.state.toLowerCase() }
      else { av = a[sortCol] || ''; bv = b[sortCol] || '' }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [rows, search, designFilter, statusFilter, activeFilter, sortCol, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // KPI stats from active members only
  const activeRows = rows.filter(r => r.isActive)
  const nssaMembers = activeRows.filter(r => r.nssaCertified)
  const irmaaMembers = activeRows.filter(r => r.irmaaCertified)
  const nssaMet = nssaMembers.filter(r => r.nssaStatus === 'met' || r.nssaStatus === 'exempt').length
  const irmaaMet = irmaaMembers.filter(r => r.irmaaStatus === 'met' || r.irmaaStatus === 'exempt').length

  function exportCSV() {
    const headers = ['First Name', 'Last Name', 'Email', 'Company', 'State', 'NSSA Certified', 'IRMAA Certified', 'Active', 'NSSA Hours', 'NSSA Status', 'IRMAA Hours', 'IRMAA Status', 'Last Submission']
    const csvRows = filtered.map(r => [
      r.firstName, r.lastName, r.email, r.company, r.state,
      r.nssaCertified ? 'Yes' : 'No',
      r.irmaaCertified ? 'Yes' : 'No',
      r.isActive ? 'Active' : 'Inactive',
      r.nssaHours, r.nssaStatus.toUpperCase(),
      r.irmaaHours, r.irmaaStatus.toUpperCase(),
      r.lastDate || ''
    ])
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `nssa-ce-report-${selectedYear}.csv`; a.click()
  }

  const thStyle = (col, bg = '#1a1a1a') => ({
    padding: '11px 14px', textAlign: 'left', fontSize: '12px', fontWeight: 500,
    color: 'white', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    background: bg
  })
  const td = { padding: '11px 14px', fontSize: '13px', verticalAlign: 'middle' }
  const SortIcon = ({ col }) => (
    <span style={{ marginLeft: 3, fontSize: 10, color: sortCol === col ? 'white' : 'rgba(255,255,255,0.35)' }}>
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )
  const selectStyle = { fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px' }}>Member CE Dashboard</h1>
          <p style={{ color: GRAY.text, fontSize: '14px' }}>{selectedYear} CE tracking — {activeRows.length} active certified members</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          <img src="/nssa-irmaa-logos.png" alt="logos" style={{ height: '50px', width: 'auto' }} />
          <Link href="/dashboard" style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none' }}>← Member Portal</Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '1.5rem' }}>
        <KpiCard label="Total Active" value={activeRows.length} color="#111" />
        <KpiCard label="NSSA Certified" value={nssaMembers.length} color={NSSA.medium} />
        <KpiCard label="NSSA Req. Met" value={nssaMet} sub={pct(nssaMet, nssaMembers.length) + ' of NSSA'} color={NSSA.dark} />
        <KpiCard label="NSSA Not Met" value={nssaMembers.length - nssaMet} sub={pct(nssaMembers.length - nssaMet, nssaMembers.length) + ' of NSSA'} color={nssaMembers.length - nssaMet > 0 ? '#dc2626' : GRAY.text} />
        <KpiCard label="IRMAA Req. Met" value={irmaaMet} sub={pct(irmaaMet, irmaaMembers.length) + ' of IRMAA'} color={IRMAA.dark} />
        <KpiCard label="IRMAA Not Met" value={irmaaMembers.length - irmaaMet} sub={pct(irmaaMembers.length - irmaaMet, irmaaMembers.length) + ' of IRMAA'} color={irmaaMembers.length - irmaaMet > 0 ? '#dc2626' : GRAY.text} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search name, email, company…" value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          style={{ ...selectStyle, minWidth: '240px' }} />

        <select style={selectStyle} value={selectedYear}
          onChange={e => window.location.href = `/admin/members?year=${e.target.value}`}>
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select style={selectStyle} value={designFilter}
          onChange={e => { setDesignFilter(e.target.value); setPage(1) }}>
          <option value="all">All designations</option>
          <option value="nssa">NSSA® only</option>
          <option value="irmaa">IRMAACP™ only</option>
        </select>

        <select style={selectStyle} value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="all">All statuses</option>
          <option value="met">Requirement met</option>
          <option value="progress">In progress</option>
          <option value="unstarted">Not started</option>
          <option value="exempt">Exempt (new cert)</option>
        </select>

        <select style={selectStyle} value={activeFilter}
          onChange={e => { setActiveFilter(e.target.value); setPage(1) }}>
          <option value="active">Active only</option>
          <option value="all">All members</option>
          <option value="inactive">Inactive only</option>
        </select>

        <span style={{ fontSize: '13px', color: GRAY.text, marginLeft: 'auto' }}>
          {filtered.length} member{filtered.length !== 1 ? 's' : ''}
        </span>

        <button onClick={exportCSV} style={{
          fontSize: '13px', padding: '6px 14px', borderRadius: '6px',
          border: `1px solid ${GRAY.border}`, background: 'white', cursor: 'pointer', fontWeight: 500
        }}>
          ↓ Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle('name')} onClick={() => handleSort('lastName')}>Name <SortIcon col="lastName" /></th>
              <th style={thStyle('lastName')} onClick={() => handleSort('lastName')}>Last Name <SortIcon col="lastName" /></th>
              <th style={thStyle('state')} onClick={() => handleSort('state')}>State <SortIcon col="state" /></th>
              <th style={{ ...thStyle('nssaHours', NSSA.dark), minWidth: '110px' }} onClick={() => handleSort('nssaHours')}>NSSA Hours <SortIcon col="nssaHours" /></th>
              <th style={{ ...thStyle('nssaStatus', NSSA.dark) }}>NSSA Status</th>
              <th style={{ ...thStyle('irmaaHours', IRMAA.dark), minWidth: '120px' }} onClick={() => handleSort('irmaaHours')}>IRMAA Hours <SortIcon col="irmaaHours" /></th>
              <th style={{ ...thStyle('irmaaStatus', IRMAA.dark) }}>IRMAA Status</th>
              <th style={thStyle('lastDate')} onClick={() => handleSort('lastDate')}>Last Submission <SortIcon col="lastDate" /></th>
              <th style={{ ...thStyle(''), cursor: 'default' }}></th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((r, i) => (
              <tr key={r.email} style={{ borderTop: i > 0 ? `1px solid ${GRAY.bg}` : 'none', background: !r.isActive ? '#fafafa' : 'white', opacity: r.isActive ? 1 : 0.6 }}>
                <td style={td}>
                  <p style={{ fontWeight: 500, fontSize: '13px', marginBottom: '1px' }}>
                    {r.firstName} {r.lastName}
                    {!r.isActive && <span style={{ fontSize: '10px', marginLeft: '6px', color: GRAY.text, background: GRAY.bg, padding: '1px 5px', borderRadius: '3px' }}>inactive</span>}
                  </p>
                  <p style={{ fontSize: '11px', color: GRAY.text }}>{r.email}</p>
                  {r.company && <p style={{ fontSize: '11px', color: GRAY.text }}>{r.company}</p>}
                </td>
                <td style={{ ...td, fontWeight: 500 }}>{r.lastName || <span style={{ color: GRAY.text }}>—</span>}</td>
                <td style={{ ...td, color: GRAY.text, fontSize: '12px' }}>{r.state || '—'}</td>
                <td style={td}>
                  {r.nssaCertified
                    ? <span style={{ fontSize: '13px', fontWeight: 600, color: r.nssaStatus === 'met' || r.nssaStatus === 'exempt' ? NSSA.dark : r.nssaStatus === 'unstarted' ? '#dc2626' : '#854d0e' }}>{r.nssaStatus === 'exempt' ? '4 ✓' : `${r.nssaHours} / 4`}</span>
                    : <span style={{ color: GRAY.text }}>—</span>}
                </td>
                <td style={td}>
                  {r.nssaCertified ? <StatusPill status={r.nssaStatus} hours={r.nssaHours} /> : <span style={{ color: GRAY.text }}>—</span>}
                </td>
                <td style={td}>
                  {r.irmaaCertified
                    ? <span style={{ fontSize: '13px', fontWeight: 600, color: r.irmaaStatus === 'met' || r.irmaaStatus === 'exempt' ? IRMAA.dark : r.irmaaStatus === 'unstarted' ? '#dc2626' : '#854d0e' }}>{r.irmaaStatus === 'exempt' ? '4 ✓' : `${r.irmaaHours} / 4`}</span>
                    : <span style={{ color: GRAY.text }}>—</span>}
                </td>
                <td style={td}>
                  {r.irmaaCertified ? <StatusPill status={r.irmaaStatus} hours={r.irmaaHours} /> : <span style={{ color: GRAY.text }}>—</span>}
                </td>
                <td style={{ ...td, color: GRAY.text, fontSize: '12px' }}>
                  {r.lastDate ? new Date(r.lastDate).toLocaleDateString() : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <Link href={`/admin/member-view?email=${encodeURIComponent(r.email)}`}
                    style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    View →
                  </Link>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr><td colSpan={9} style={{ padding: '2.5rem', textAlign: 'center', color: GRAY.text, fontSize: '13px' }}>
                No members match the current filters.
              </td></tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: `1px solid ${GRAY.bg}`, background: '#fafafa' }}>
            <span style={{ fontSize: '12px', color: GRAY.text }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setPage(1)} disabled={page === 1}
                style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>Prev</button>
              <span style={{ fontSize: '12px', padding: '4px 10px', color: GRAY.text }}>Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>Next</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
