/**
 * ACT task guide cards (Arisha main review, 2 Nov 2026): for each ACT task, what to enter, which documents, where to
 * find them and whom to ask. Deterministic text, BM first with English below; it names only the real record reference
 * and the people already on the record, and invents no fields or contacts. Missing evidence stays "unresolved".
 */
export type ActGuideKind = 'owner_plan' | 'owner_fix' | 'act_check' | 'act_follow' | 'audit' | 'report_review' | 'field_check' | 'timing' | 'investigation';

export type ActGuideCtx = {
  ref: string;
  /** People already on the record: the owner, who raised it, the team, and the Director. */
  owner?: string | null;
  raisedBy?: string | null;
  team?: number | null;
  director?: string | null;
  evidence?: string | null;
  screen?: string | null;
};

export type ActGuide = { title: string; enter: string[]; documents: string[]; where: string; ask: string };

const bi = (ms: string, en: string) => `${ms} / ${en}`;

export function actGuide(kind: ActGuideKind, c: ActGuideCtx): ActGuide {
  const director = c.director ?? bi('Pengarah ACT', 'the ACT Director');
  const teamTxt = c.team ? bi(`Pasukan ${c.team} ACT`, `ACT Team ${c.team}`) : director;
  const evidence = c.evidence?.trim() ? c.evidence : bi('Belum disahkan: tiada bukti direkod', 'Unresolved: no evidence recorded');
  const where = c.screen ? bi(`Skrin ${c.screen} dalam Prima`, `the ${c.screen} screen in Prima`) : bi('Rekod asal dalam Prima', 'the original record in Prima');
  switch (kind) {
    case 'owner_plan':
      return {
        title: bi(`${c.ref}: rancang pembetulan`, `${c.ref}: plan the fix`),
        enter: [bi('Punca sebenar masalah', 'The real cause'), bi('Apa yang akan diubah', 'What you will change'), bi('Tarikh siap', 'The date it will be done')],
        documents: [bi(`Bukti yang ACT lihat: ${evidence}`, `What ACT saw: ${evidence}`)],
        where,
        ask: c.raisedBy ? bi(`${c.raisedBy} (yang membuka dapatan ini)`, `${c.raisedBy}, who raised this finding`) : teamTxt,
      };
    case 'owner_fix':
      return {
        title: bi(`${c.ref}: tanda sudah dibetulkan`, `${c.ref}: mark it fixed`),
        enter: [bi('Bukti pembetulan: nombor rekod, gambar atau prosedur baru', 'Proof of the fix: record numbers, photos or the new procedure')],
        documents: [bi('Rekod selepas pembetulan', 'The records after the fix')],
        where,
        ask: teamTxt,
      };
    case 'act_check':
      return {
        title: bi(`${c.ref}: semak pembetulan`, `${c.ref}: check the fix`),
        enter: [bi('Apa yang disemak dan hasilnya', 'What you checked and what you found'), bi('Tutup hanya jika pembetulan berkesan', 'Close only if the fix works')],
        documents: [bi('Bukti pemilik dan rekod semasa dalam Prima', "The owner's proof and the current records in Prima")],
        where,
        ask: c.owner ? bi(`${c.owner} (pemilik)`, `${c.owner}, the owner`) : bi('Pemilik dapatan', 'The owner of the finding'),
      };
    case 'act_follow':
      return {
        title: bi(`${c.ref}: susulan dengan pemilik`, `${c.ref}: follow up the owner`),
        enter: [bi('Cara susulan (panggilan, mesej, e-mel, lawatan, mesyuarat, memo)', 'How you followed up (call, message, email, visit, meeting, memo)'), bi('Apa kata pemilik', 'What the owner said'), bi('Tarikh susulan seterusnya', 'The next follow-up date')],
        documents: [bi('Tiada dokumen wajib; catat janji pemilik', "No document needed; note the owner's promise")],
        where: bi('Tab Dapatan ACT', 'the ACT Findings tab'),
        ask: bi(`${director} jika pemilik tidak bertindak`, `${director} if the owner does not act`),
      };
    case 'audit':
      return {
        title: bi(`${c.ref}: audit aliran kerja`, `${c.ref}: workflow audit`),
        enter: [bi('Tarikh audit, sampel dan tempoh disemak', 'Audit date, sample and period checked'), bi('Bersih atau dapatan dibuka', 'Clean or findings raised')],
        documents: [bi('Rekod sampel daripada skrin aliran kerja', 'Sample records from the workflow screen')],
        where,
        ask: director,
      };
    case 'report_review':
      return {
        title: bi(`${c.ref}: semak laporan bulanan`, `${c.ref}: review the monthly report`),
        enter: [bi('Tepat masa? Lengkap ikut borang? Angka sepadan dengan Prima?', 'On time? Complete against the form? Figures match Prima?'), bi('Bersih atau dapatan dibuka', 'Clean or findings raised')],
        documents: [bi('Laporan yang dihantar dan rekod Prima untuk angka yang sama', 'The report sent and the Prima records for the same figures')],
        where: bi('Skrin Laporan (Pejabat Pengarah) dan tab Laporan bulanan ACT', 'the Reports screen (Director Office) and the ACT Monthly reports tab'),
        ask: director,
      };
    case 'field_check':
      return {
        title: bi(`${c.ref}: semakan di lapangan`, `${c.ref}: field check`),
        enter: [bi('Tempat dan tarikh lawatan', 'Where and when you checked'), bi('Masa sebenar setiap langkah', 'The real time each step took'), bi('Apa yang dilihat', 'What you saw')],
        documents: [bi('Pemerhatian anda; gambar jika perlu dalam dapatan', 'Your observations; photos go with a finding if needed')],
        where: bi('Tempat kerja sebenar, kemudian tab Masa aliran kerja', 'the real workplace, then the Workflow timing tab'),
        ask: director,
      };
    case 'investigation':
      return {
        title: bi(`${c.ref}: siasatan`, `${c.ref}: investigation`),
        enter: [bi('Bukti: lampirkan salinan rekod dan nyatakan dari mana', 'Evidence: attach a copy of the record and say where it came from'), bi('Nota kerja', 'Working notes'), bi('Pengarah: keputusan dan sebab', 'Director: the outcome and the reason')],
        documents: [bi(`Asas siasatan: ${evidence}`, `What started it: ${evidence}`)],
        where: bi('Tab Corak dan siasatan ACT', 'the ACT Patterns and investigations tab'),
        ask: director,
      };
    case 'timing':
      return {
        title: bi(`${c.ref}: tetapkan masa aliran kerja`, `${c.ref}: set the workflow timing`),
        enter: [bi('Audit asas (yang sudah selesai)', 'The finished audit it rests on'), bi('Kekerapan audit dan masa setiap langkah', 'Audit frequency and time per step'), bi('Sebab', 'The reason')],
        documents: [bi('Hasil audit dan semakan lapangan', 'The audit result and field checks')],
        where: bi('Tab Masa aliran kerja ACT', 'the ACT Workflow timing tab'),
        ask: bi('Ketua jabatan aliran kerja itu', 'The head of that workflow’s department'),
      };
  }
}
