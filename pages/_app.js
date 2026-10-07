import { useRouter } from 'next/router'
import MemberNav from '../components/MemberNav'
import '../styles/globals.css'

// Pages that should NOT show the global nav bar.
const NO_NAV = new Set(['/login', '/auth/callback'])

export default function App({ Component, pageProps }) {
  const router = useRouter()

  // Skip nav on auth pages and the admin section.
  const showNav = !NO_NAV.has(router.pathname) && !router.pathname.startsWith('/admin')

  return (
    <>
      {showNav && <MemberNav />}
      <Component {...pageProps} />
    </>
  )
}
