/** P125: the IT support role, whose changes wait for an owner or a global admin (Members,
 * Organization and Approvals pages, lib/api.ts notice). Terms as work-mail-p124.ts: approval =
 * kelulusan, request = permohonan; "Global admin" = Admin global, "IT support" = Sokongan IT. */
export const IT_SUPPORT_P125: Record<string, string> = {
  // Roles (lib/types ROLE_INFO, pages/members.tsx)
  "Global admin": "Admin global",
  "IT support": "Sokongan IT",
  "Like a global admin, but every change they make to members, the organization, access and settings waits for an owner or a global admin to approve it.":
    "Seperti admin global, tetapi setiap perubahan yang dibuat pada ahli, organisasi, akses dan tetapan menunggu kelulusan pemilik atau admin global.",
  "Global admins see the whole workspace.": "Admin global melihat seluruh ruang kerja.",
  "IT support see the whole workspace. Their changes wait for approval.":
    "Sokongan IT melihat seluruh ruang kerja. Perubahan mereka menunggu kelulusan.",
  // The notice when a change is held (lib/api.ts)
  "Sent to the admins for approval: {summary}": "Dihantar kepada admin untuk kelulusan: {summary}",
  // Statuses (lib/held.ts)
  Applying: "Sedang dilaksanakan",
  // Members and Organization (components/held-changes.tsx)
  "Your changes go to an owner or global admin for approval.":
    "Perubahan anda dihantar kepada pemilik atau admin global untuk kelulusan.",
  "Waiting for approval ({n})": "Menunggu kelulusan ({n})",
  // The Approvals page (pages/approvals.tsx, components/held-changes.tsx)
  "Changes by IT support": "Perubahan oleh sokongan IT",
  "Change by IT support": "Perubahan oleh sokongan IT",
  "No changes by IT support": "Tiada perubahan oleh sokongan IT",
  "When IT support adds or changes members, the organization, access or settings, the change waits here until an owner or a global admin approves it.":
    "Apabila sokongan IT menambah atau mengubah ahli, organisasi, akses atau tetapan, perubahan itu menunggu di sini sehingga pemilik atau admin global meluluskannya.",
  "No change by IT support waits for you.": "Tiada perubahan oleh sokongan IT yang menunggu anda.",
  "My changes": "Perubahan saya",
  "Approved and done. {name} is told.": "Diluluskan dan sudah dibuat. {name} dimaklumkan.",
  "Could not be applied: {message}": "Tidak dapat dilaksanakan: {message}",
  "Change cancelled.": "Perubahan dibatalkan.",
  "Cancel this change": "Batalkan perubahan ini",
  "{name} is no longer IT support (now {role}). IT support's rules still apply to this change.":
    "{name} bukan lagi sokongan IT (kini {role}). Peraturan sokongan IT masih terpakai pada perubahan ini.",
  "{name} is no longer a member here. IT support's rules still apply to this change.":
    "{name} bukan lagi ahli di sini. Peraturan sokongan IT masih terpakai pada perubahan ini.",
  "Expires {when} if nobody decides it.": "Tamat tempoh {when} jika tiada sesiapa memutuskannya.",
  "One-time password (shown once, give it to them):":
    "Kata laluan sekali guna (dipaparkan sekali, berikan kepada mereka):",
  // The bell (components/needs-bell.tsx)
  "{n} changes by IT support to approve": "{n} perubahan oleh sokongan IT untuk diluluskan",
  "Change by IT support to approve": "Perubahan oleh sokongan IT untuk diluluskan",
};
