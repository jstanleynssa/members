import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/find']

export async function middleware(req) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  const isCallback = pathname.startsWith('/auth/callback')
  const isKajabiSSO = pathname.startsWith('/api/auth/kajabi-sso')
  const isZoomWebhook = pathname.startsWith('/api/zoom-webhook')
  const isCeStatus = pathname.startsWith('/api/ce-status')
  const isSavePhoto = pathname.startsWith('/api/save-profile-photo')
  const isInvite = pathname.startsWith('/api/invite')
  const isCeApproval = pathname.startsWith('/api/ce-approval-notify')

  // Noindex all auth/utility paths — these are never meant to appear in search results.
  const isNoindex = isPublic || isCallback || isKajabiSSO || isInvite
  if (isNoindex) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  if (isCallback || isPublic || isKajabiSSO || isZoomWebhook || isCeStatus || isSavePhoto || isInvite || isCeApproval) {
    return res
  }

  if (!session) {
  return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png).*)']
}
