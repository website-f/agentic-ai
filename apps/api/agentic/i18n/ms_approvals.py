"""P127 Malay: every Microsoft approval of the office, one opened, answers with a reason and the
answers a person's own AI prepared (microsoft/org_approvals.py, agents/approval_tools.py)."""

MS_APPROVALS: dict[str, str] = {
    "That approval was not found.": "Kelulusan itu tidak dijumpai.",
    "Give a reason for your answer (approve or reject).": (
        "Berikan sebab bagi jawapan anda (lulus atau tolak)."
    ),
    "Microsoft did not answer. Try again.": "Microsoft tidak menjawab. Cuba lagi.",
    "This approval is not waiting for an answer any more.": (
        "Kelulusan ini tidak lagi menunggu jawapan."
    ),
    "Pick one of the approval's answers.": "Pilih salah satu jawapan kelulusan itu.",
    "You cannot answer your own request. Another approver does.": (
        "Anda tidak boleh menjawab permohonan anda sendiri. Pelulus lain yang menjawabnya."
    ),
    "This approval is not waiting for your answer.": "Kelulusan ini tidak menunggu jawapan anda.",
    "Microsoft did not take the answer. Try again.": (
        "Microsoft tidak menerima jawapan itu. Cuba lagi."
    ),
    "{name} prepared an approval answer": "{name} menyediakan jawapan kelulusan",
    "{answer}: {title}\n\nNothing is sent until you press Send.": (
        "{answer}: {title}\n\nTiada apa yang dihantar sehingga anda tekan Hantar."
    ),
    "That prepared answer was not found.": "Jawapan yang disediakan itu tidak dijumpai.",
    "That prepared answer was already used.": "Jawapan yang disediakan itu sudah digunakan.",
    # tool labels (agents/approval_tools.py)
    "List Microsoft approvals": "Senaraikan kelulusan Microsoft",
    "Read a Microsoft approval": "Baca kelulusan Microsoft",
    "Prepare an approval answer": "Sediakan jawapan kelulusan",
}
