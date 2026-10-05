/** SOPs and workflows the AI drafts from company documents (P24). Entries here override earlier files. */
export const BUILDERS: Record<string, string> = {
  // Build from picked documents (components/doc-builders.tsx)
  "Make an SOP": "Jadikan SOP",
  "Build a workflow": "Bina aliran kerja",
  "Reading the documents and writing the SOP…": "Membaca dokumen dan menulis SOP…",
  "Reading the documents and drafting the workflow…": "Membaca dokumen dan menyediakan draf aliran kerja…",
  "Long documents take a few minutes; you can leave this page.": "Dokumen yang panjang ambil masa beberapa minit; anda boleh tinggalkan halaman ini.",
  "SOP draft ready.": "Draf SOP sudah siap.",
  "Workflow draft ready.": "Draf aliran kerja sudah siap.",
  "SOP draft ready. Check it, then approve it.": "Draf SOP sudah siap. Semak dahulu, kemudian luluskan.",
  "Workflow draft ready. Check the steps, then switch it on.": "Draf aliran kerja sudah siap. Semak langkahnya, kemudian aktifkan.",
  "Review and approve it": "Semak dan luluskan",
  "Open it in the editor": "Buka dalam editor",
  "The build failed. Try again.": "Binaan gagal. Cuba lagi.",
  "Pick the documents that describe one procedure.": "Pilih dokumen yang menerangkan satu prosedur.",
  "Only this part (optional)": "Bahagian ini sahaja (pilihan)",
  "Only this part (optional), e.g. Salary advance": "Bahagian ini sahaja (pilihan), cth. Wang pendahuluan gaji",
  "Section: {name}": "Bahagian: {name}",
  "The AI drafts it from these documents. Agents use it only after a person approves it.": "AI menyediakan drafnya daripada dokumen ini. Ejen hanya menggunakannya selepas diluluskan oleh seseorang.",

  // Suggestions from an upload
  "Suggested": "Dicadangkan",
  "Building": "Sedang dibina",
  "Draft ready": "Draf siap",
  "Dismissed": "Diabaikan",
  "SOP": "SOP",
  "Workflow": "Aliran kerja",
  "1 document": "1 dokumen",
  "{n} documents": "{n} dokumen",
  "Open draft": "Buka draf",
  "Reading the documents…": "Membaca dokumen…",
  "Build": "Bina",
  "Build anyway": "Bina juga",
  "No SOP or workflow suggestions from these documents.": "Tiada cadangan SOP atau aliran kerja daripada dokumen ini.",
  "Built SOPs and workflows are drafts: agents use them only after a person approves them.": "SOP dan aliran kerja yang dibina masih draf: ejen hanya menggunakannya selepas diluluskan oleh seseorang.",

  // SOPs page: drafts written by AI
  "Approved. Agents in scope follow it from their next step.": "Diluluskan. Ejen dalam skop mengikutinya mulai langkah seterusnya.",
  "Edit before approving": "Sunting sebelum meluluskan",
  "Save draft": "Simpan draf",
  "Written by AI from your documents. Agents don't see it until someone approves it. Check the steps, amounts and deadlines against the source first.": "Ditulis oleh AI daripada dokumen anda. Ejen tidak nampak SOP ini selagi belum diluluskan. Semak dahulu langkah, amaun dan tarikh akhir dengan dokumen asal.",
  "Built from: {names}": "Dibina daripada: {names}",

  // Workflows built from documents
  "Built from documents": "Dibina daripada dokumen",
};
