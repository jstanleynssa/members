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

if (isCallback || isPublic || isKajabiSSO || isZoomWebhook) return res

  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png).*)']
}
