// pages/profile/edit.js
//
// The profile editor has been consolidated into the main dashboard
// (pages/dashboard.js), which is now the single canonical place to edit
// a member profile. This route used to host a second, separate copy of the
// same form — that duplication caused the two forms to drift out of sync
// (including the /api/profile/save vs /api/save bug). To avoid maintaining
// two editors, /profile/edit now simply redirects to the dashboard's
// profile section.
//
// The redirect is server-side so it fires before any render and works for
// direct visits, bookmarks, and old links alike.

export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/dashboard#profile',
      permanent: false, // 307 — keep it non-permanent in case we ever split editors again
    },
  }
}

// This component never renders (getServerSideProps always redirects), but
// Next.js requires a default export from a page file.
export default function ProfileEditRedirect() {
  return null
}
