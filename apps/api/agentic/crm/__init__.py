"""P35: customers and suppliers (parties), the sales pipeline (deals), and money owed to and
by the companies (receivables and payables), with bills captured from email and payment
reminders. A light CRM + AR/AP the accounting sync (Xero, QuickBooks, Bukku, MyInvois) builds
on next.

- service.py: matching, totals, payments, interactions, balances, aging, forecast, summary
- access.py: who sees which parties and money (people and agents)
- capture.py: a supplier bill from a PDF or picture (one cheap model call)
- reminders.py: payment-reminder drafts (Outlook approvals) and the hourly job
- mail.py: an email from a known party lands on its timeline
"""
