// Generated from the P87 screen guide review of each screen's code. Edit here; keep quoted words exactly as on screen.
import type { ScreenGuide } from './arisha-screens';

export const SCREEN_GUIDES: ScreenGuide[] = [
  {
    "view": "home",
    "title": "Home",
    "what": "Your first screen: what needs you today, a row of key numbers, and the things you should keep an eye on. Every line opens the screen where the work is done.",
    "who": "Directors and group leaders, company managers, admin executives and supervisors. Company managers and admin executives see the company chosen at the top. Group leaders see the whole group and also a \"Growth\" panel; the CEO also sees \"Approval limits\".",
    "tabs": [],
    "tasks": [
      {
        "task": "How to deal with something on my list",
        "steps": [
          "Look at the \"To do now\" (or \"Do today\") cards at the top.",
          "Press the card. It says \"Open\" at the bottom.",
          "Prima takes you to the right screen to finish the work."
        ]
      },
      {
        "task": "How to find a screen",
        "steps": [
          "Scroll to \"All your screens\". Each card is one area, such as \"Operations\" or \"People and HR\", with its screens and one line on what each is for.",
          "Press a screen to open it. \"Recently opened\" above the cards shows the screens you used last.",
          "Or type in \"Find a screen\" (or in \"Search the menu\" at the top of the menu; press / on a computer). Words like \"gaji\", \"cuti\" or \"pekerja asing\" work too."
        ]
      },
      {
        "task": "How to see all items in one area",
        "steps": [
          "Scroll to the \"Monitor\" list (or the to-do list).",
          "Items are grouped by area, each with a count.",
          "Press \"Show all\" under a group to see every item, \"Show fewer\" to fold it again."
        ]
      },
      {
        "task": "How to see site margins (group leaders)",
        "steps": [
          "In the \"Growth\" panel, find \"Site margin\".",
          "Press \"Load site margin\".",
          "Use the \"By company\" table to open a company's contracts, clients or roster."
        ]
      },
      {
        "task": "How to change approval limits (CEO)",
        "steps": [
          "In \"Approval limits\" press \"Change limits\".",
          "Fill in the two RM amounts (leave empty for no limit).",
          "Write the reason in \"Why\".",
          "Press \"Save\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Unknown",
        "means": "No data recorded in Prima yet. It is never counted as fine or as zero."
      },
      {
        "term": "Monitor",
        "means": "Things other people are handling that you only watch."
      }
    ],
    "notes": "\"Nothing needs your decision today.\" means your list is empty, not that something is broken. A number tile you can press opens its screen. The Growth figures show Unknown for companies with no contracts, leads or roster in Prima yet; collection days wait for Finance to record the month-end ageing."
  },
  {
    "view": "overview",
    "title": "Group",
    "what": "The whole group on one page: today's shifts, guards on duty, no-shows, open cases and company licences, with one card per company.",
    "who": "Directors and group leadership only. Live figures come only from pilot companies; other companies show licence dates and Unknown for the rest.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find a company",
        "steps": [
          "Type in \"Search companies or states\".",
          "Or press a filter: \"All\", \"Pilot\", \"Licence expired\", \"Licence due\" or \"No licence record\"."
        ]
      },
      {
        "task": "How to open one company's day",
        "steps": [
          "Find the company card.",
          "Press its name or \"Open company\".",
          "Prima opens \"Company today\" for that company."
        ]
      },
      {
        "task": "How to see every company card",
        "steps": [
          "Scroll to the bottom of the list.",
          "Press \"Show all ... companies\"."
        ]
      },
      {
        "task": "How to read a company card",
        "steps": [
          "Red edge: expired licence, a P1 case or a no-show.",
          "Amber edge: licence due or guard papers to fix.",
          "\"Act\" means you can act for that company; \"Monitor\" means view only."
        ]
      }
    ],
    "terms": [
      {
        "term": "Pilot company",
        "means": "A company already sending its live data into Prima."
      },
      {
        "term": "No-shows",
        "means": "Guards whose shift started 15 or more minutes ago with no clock-in."
      },
      {
        "term": "P1",
        "means": "The most serious kind of case."
      },
      {
        "term": "Papers to fix",
        "means": "Guard licences or permits that are expired or due soon."
      }
    ],
    "notes": "\"Open company\" only shows for pilot companies; others are \"Summary only\". The \"Company record\" button only shows to people who keep company records. A card that says \"Unknown until connected\" has no data in Prima yet."
  },
  {
    "view": "company",
    "title": "Company today",
    "what": "Today's picture for one company: shifts, who is on duty, no-shows, guards who cannot work, open cases, guard papers and company licences.",
    "who": "Company managers, admin executives and group leadership. Group leaders choose the company in the \"Company\" box at the top. Only the company manager also sees \"Vacancies\" and \"Staff movement\" here.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to see who has not turned up",
        "steps": [
          "Look at \"No-shows right now\" under \"People on duty\".",
          "Each line shows the site, post and start time."
        ]
      },
      {
        "task": "How to fix a guard who cannot work",
        "steps": [
          "Look at \"Rostered but not allowed to work\".",
          "Press the guard's line to open their record on the Guards screen."
        ]
      },
      {
        "task": "How to check company licences",
        "steps": [
          "Scroll to \"Company licences\".",
          "Press \"Add licence\" to add one, or \"Import\" to load a file.",
          "Press \"All licences\" for the full list."
        ]
      },
      {
        "task": "How to raise a vacancy (company manager)",
        "steps": [
          "In \"Vacancies\" press \"Raise a vacancy\".",
          "Fill in \"Job title\", \"Kind of post\", \"How many\", pay and \"Why the post is needed\".",
          "Press \"Send to the CEO\"."
        ]
      },
      {
        "task": "How to open a case",
        "steps": [
          "In \"Open cases\" press a case, or \"All cases\" for the list."
        ]
      }
    ],
    "terms": [
      {
        "term": "Unfilled",
        "means": "A shift with no guard assigned."
      },
      {
        "term": "Response late",
        "means": "The case was not answered in the time allowed."
      }
    ],
    "notes": "If the company has no detailed data yet, only licence dates show and figures are Unknown. \"Add licence\" and \"Import\" only show to people who keep licence records. Vacancies need a comment at every step; the CEO approves first, then the company head signs; for PWVSB central posts the CEO approves and signs in one step."
  },
  {
    "view": "office",
    "title": "Company office",
    "what": "Each company's own office team: who the executives are, which desk each one owns with a backup, and the office work waiting on each desk.",
    "who": "Company managers and admin executives see their own office. Group leaders see \"Company offices\" for all companies and can open each one. A far-branch manager does not get this screen.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to share out desks (Company Manager or GM)",
        "steps": [
          "Scroll to \"Desks\".",
          "Press \"Share out desks\".",
          "For each desk choose the \"Owner\" and \"Backup\".",
          "Add a \"Note (optional)\".",
          "Press \"Save desks\"."
        ]
      },
      {
        "task": "How to see only my own work (executive)",
        "steps": [
          "In the \"Work\" box press \"Show only mine\".",
          "Press \"The whole office\" to see everyone's work.",
          "Press a line to open the screen where it is done."
        ]
      },
      {
        "task": "How to look at another company's office (group leaders)",
        "steps": [
          "Press the company name or \"Open office\".",
          "Press \"All offices\" to go back."
        ]
      },
      {
        "task": "How to filter all office work by desk (group leaders)",
        "steps": [
          "In \"All office work, by desk\" press a desk button.",
          "Press \"Show all desks\" to clear it."
        ]
      },
      {
        "task": "How to set a company to be run by another office (Chief of Staff or CEO)",
        "steps": [
          "In \"Companies run by another office\" choose the \"Company\".",
          "Choose \"Run by\".",
          "Write the \"Reason\".",
          "Press \"Save\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Backup",
        "means": "The person who takes the desk's work when the owner is on leave."
      },
      {
        "term": "Not shared out",
        "means": "The desk has no owner yet, so its work stays with the head."
      }
    ],
    "notes": "\"Share out desks\" only shows to the head. If you see \"The company office is not switched on in this database yet\", desks cannot be saved yet. The \"How to do it\" cards are help only; they do not save anything."
  },
  {
    "view": "sites",
    "title": "Sites",
    "what": "The list of guarded sites with posts, guards on duty, today's problems and open cases. Open a site for its roster, posts, patrol checkpoints, visits and logs.",
    "who": "Directors and group staff, company managers, admin executives and supervisors. Add and Edit buttons only show to people who keep that record.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find a site",
        "steps": [
          "Type in \"Search name, code or town\".",
          "Or press \"Needs attention\" or \"Armed\".",
          "Press the site to open it."
        ]
      },
      {
        "task": "How to add a site",
        "steps": [
          "Press \"Add site\".",
          "Fill in the form and press \"Save\".",
          "Then add its posts and patrol checkpoints."
        ]
      },
      {
        "task": "How to add a post or checkpoint",
        "steps": [
          "Open the site.",
          "Press \"Add post\" or \"Add checkpoint\".",
          "Fill in and press \"Save\"."
        ]
      },
      {
        "task": "How to record a site visit",
        "steps": [
          "Open the site, go to \"Site visits\".",
          "Write why you are visiting, press \"Start site visit\".",
          "Take photos, write what you found.",
          "Press \"Close visit\"."
        ]
      },
      {
        "task": "How to change patrol time",
        "steps": [
          "Open the site, find \"Patrol time\".",
          "Press \"Change\", pick the time and the client request.",
          "Press \"Save\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Post",
        "means": "A guard position at a site with its shift pattern."
      },
      {
        "term": "Problems",
        "means": "No-shows, late guards and unfilled shifts today."
      },
      {
        "term": "Armed",
        "means": "A site where guards carry firearms."
      }
    ],
    "notes": "\"Change\" on patrol time only shows to people allowed to set it. A visit started away from the site shows in red. \"Open roster\" in a site takes you to its Roster."
  },
  {
    "view": "roster",
    "title": "Roster",
    "what": "The weekly shift plan for one site. Add shifts, assign guards and publish the week. Prima checks papers, age, hours and rest before it allows a guard.",
    "who": "Directors and group staff, company managers, admin executives and supervisors. Only people allowed to edit see \"Add shifts\"; only people allowed to publish see \"Publish this week\".",
    "tabs": [],
    "tasks": [
      {
        "task": "How to assign a guard",
        "steps": [
          "Choose the site in the box at the top.",
          "Press a shift cell.",
          "Search in \"Search guard name or staff number\".",
          "Press \"Assign\"."
        ]
      },
      {
        "task": "How to add shifts",
        "steps": [
          "Press \"Add shifts\".",
          "Choose the \"Post\", \"First day\" and \"How many days\".",
          "Press \"Add shifts\". They start as unfilled drafts."
        ]
      },
      {
        "task": "How to publish the week",
        "steps": [
          "Assign guards to the drafts.",
          "Press \"Publish this week\"."
        ]
      },
      {
        "task": "How to remove a guard from a shift",
        "steps": [
          "Press the shift.",
          "Press \"Remove guard from this shift\"."
        ]
      },
      {
        "task": "How to change weeks",
        "steps": [
          "Press the left or right arrow, or \"This week\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Draft",
        "means": "Not yet published, so guards do not see it."
      },
      {
        "term": "Not allowed to work",
        "means": "The guard's papers or checks fail, so they cannot be rostered."
      },
      {
        "term": "Unfilled",
        "means": "No guard assigned yet."
      }
    ],
    "notes": "Past shifts cannot be changed. The \"Assign\" button is grey for a guard who fails the checks. A site needs posts before shifts can be added. Armed sites need guards with a firearm permit."
  },
  {
    "view": "duty",
    "title": "Guard duty plans",
    "what": "Plans the minute-by-minute duties for each guard post from the roster, and each patrolling officer's daily route. Prima makes and publishes the plan; the JA app (or the app in use) runs the work and reports back each month.",
    "who": "Directors, group leaders, company managers, admin executives and operations staff. The OM, Regional OM or OGM who covers the site can change terms and publish. Everyone else sees the plan marked \"View only\".",
    "tabs": [
      {
        "name": "Posts",
        "what": "The duty plan for every post at one site on the chosen date, with the client's contract terms."
      },
      {
        "name": "Officer routes",
        "what": "One patrolling officer's route for the day across the sites they cover."
      }
    ],
    "tasks": [
      {
        "task": "How to publish a site's duty plan",
        "steps": [
          "Press \"Posts\".",
          "Pick the date at the top and choose the site.",
          "Check the plan shown as \"Preview (not published)\".",
          "Press \"Publish\".",
          "If the roster changes later you see \"Roster changed since publishing\". Press \"Publish again\"."
        ]
      },
      {
        "task": "How to enter the client's contract terms",
        "steps": [
          "In \"Contract terms\" press \"Enter the contract terms\" (or \"Change terms\").",
          "Fill in \"Contract reference\", \"Rate per guard-hour (RM)\" and the other boxes.",
          "Set each shift's times and guards. Use \"Add a shift\" or \"Remove\". For a KPM school you can press \"Use the KPM school contract (2 x 12 h, 4 points, weekly visit, report by 9am)\".",
          "Press \"Save terms\"."
        ]
      },
      {
        "task": "How to plan a patrolling officer's route",
        "steps": [
          "Press \"Officer routes\" and choose the officer and the date.",
          "Change \"Starts\", \"Ends (next day if earlier)\" or \"Meal break (min)\" if needed, then press \"Plan with these hours\".",
          "Press \"Publish\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Short",
        "means": "Fewer guards on the roster than the contract needs for that shift."
      },
      {
        "term": "If not filled",
        "means": "An estimate of what the client may deduct for the gap. The client decides the real amount."
      }
    ],
    "notes": "No \"Publish\" button and a \"View only\" chip means you do not manage that site. \"No patrolling officers on sites you cover.\" means no officer is linked to your sites. Guards rostered at a time that is not a contract shift are not counted as cover. Contract deductions are estimates only."
  },
  {
    "view": "cleaning",
    "title": "Cleaning plans",
    "what": "Each cleaning site's daily plan for cleaners and supervisors, made from the client's scope and the size of each area. You also record what the supervisor reports, with time-marked photos.",
    "who": "Operations, ACT, group leaders, company managers and admin executives. The OM, Regional OM or OGM who covers the site manages it; others see \"View only\". Cleaners and supervisors do not sign in.",
    "tabs": [
      {
        "name": "Day plan",
        "what": "Today's plan for each worker and the supervisor's report."
      },
      {
        "name": "Scope and crew",
        "what": "Contract, hours, areas, sizes and crew names."
      },
      {
        "name": "Site map",
        "what": "The site map with each area placed on it."
      },
      {
        "name": "Supplies and equipment",
        "what": "Supplies, equipment, deliveries and stock checks."
      },
      {
        "name": "Client slips",
        "what": "Work that needs the client's signed slip."
      },
      {
        "name": "Monthly report",
        "what": "Plan against actual for the month."
      }
    ],
    "tasks": [
      {
        "task": "How to start cleaning on a new site",
        "steps": [
          "In \"Start cleaning on a site\" choose the \"Site\" and fill in the contract details.",
          "Press \"Start cleaning on this site\".",
          "Open \"Scope and crew\", enter the real areas and crew names, and press \"Save scope and crew\"."
        ]
      },
      {
        "task": "How to make and publish today's plan",
        "steps": [
          "Press the site in the list and open \"Day plan\".",
          "Tick anyone absent.",
          "Press \"Make the plan\" (or \"Make the plan again\").",
          "Check it, then press \"Publish\"."
        ]
      },
      {
        "task": "How to record the supervisor's report",
        "steps": [
          "Tick the tasks the supervisor reported on.",
          "Choose \"Done\", \"Checked\", \"Redo\", \"Missed\" or \"Not needed today\".",
          "For Checked, Redo or Not needed today, add the time-marked photo and type the time printed on it.",
          "Give the reason if asked, then press the \"Record\" button."
        ]
      },
      {
        "task": "How to record a delivery or stock check",
        "steps": [
          "Open \"Supplies and equipment\".",
          "Press \"Record a delivery\", \"Record a stock check\" or \"Record receipt\".",
          "Enter the amounts and press \"Save\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Time-marked photo",
        "means": "A photo with the date and time printed on it by the camera app. Ordinary photos are refused."
      }
    ],
    "notes": "Photos must be under 700 KB and sent by email, not WhatsApp (WhatsApp removes the camera time). A photo from another day or used before is refused. \"Cleaning is not set up on this site.\" means no scope yet. Client slips: press \"Upload a client slip\" under \"Client slips\"."
  },
  {
    "view": "sitestock",
    "title": "Site stock and fittings",
    "what": "One board of cleaning supplies and equipment, guard uniforms and site fittings at every site you can see. It also plans what fittings each site needs and makes sure everything comes back at contract end.",
    "who": "Directors, group leaders, operations and Procurement and Inventory staff. Company managers do not see it. The OM who covers the site records; Inventory monitors. Only a director, the COO or the CEO can approve giving an item to the client.",
    "tabs": [
      {
        "name": "All sites",
        "what": "Every site with stock flags, uniform gaps and fittings short or broken."
      },
      {
        "name": "Fittings for one site",
        "what": "The fittings plan, records and contract-end take back for one site."
      }
    ],
    "tasks": [
      {
        "task": "How to check problems across sites",
        "steps": [
          "Press \"All sites\" and look at the number boxes at the top.",
          "Press \"Fittings\" on a site to open its plan."
        ]
      },
      {
        "task": "How to plan a site's fittings",
        "steps": [
          "Press \"Fittings for one site\" and choose the site.",
          "Press \"Add an item\", or \"Add KPM guard equipment\" for a KPM guard contract.",
          "Set what is needed, the owner, and \"Take back\" or \"Hand over (contract says)\" with the \"Contract clause\".",
          "Press \"Save plan\"."
        ]
      },
      {
        "task": "How to record an install or the monthly check",
        "steps": [
          "Save the plan first.",
          "Press \"Record install\" or \"Record monthly check\".",
          "Type how many are in place and how many are broken, add the time-marked photo, and press \"Save\"."
        ]
      },
      {
        "task": "How to take items back at contract end",
        "steps": [
          "In \"Contract end: take everything back\" press \"Record take back at contract end\".",
          "Type how many came back or were handed over, add the photo of the items collected, and press \"Save\".",
          "Management can press \"Approve giving\", fill \"How many\" and \"Reason (required)\", then press \"Approve\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Not recovered",
        "means": "Items that did not come back at contract end and were not approved to give."
      }
    ],
    "notes": "\"View only\" means you do not manage this site, so the add, save and record buttons are hidden. \"Record install\" and \"Record monthly check\" stay grey until the plan is saved with no unsaved changes. Every item comes back unless the contract hands it over or the COO or CEO approves giving it."
  },
  {
    "view": "people",
    "title": "Guards",
    "what": "The list of guards and office staff, and whether each one is allowed to work. Open a person for papers, training, hours, leave, SOCSO, warnings and appeals, and their phone sign-in. Some staff can look up a person's history in the group.",
    "who": "Directors and group staff, company managers, admin executives and supervisors. HR and group leaders see it as \"People\" and can switch to \"PWVSB central staff\". Pay and \"Benefits\" show only to people allowed to see pay. \"Group history\" is for HR only.",
    "tabs": [
      {
        "name": "Work",
        "what": "Personal details, can this guard work today, PIN and access, recent shifts."
      },
      {
        "name": "Training",
        "what": "What is coming next, licences and certificates."
      },
      {
        "name": "Hours and pay",
        "what": "Hours worked (shown as \"Hours\" if pay is hidden)."
      },
      {
        "name": "Leave",
        "what": "Leave balances and requests."
      },
      {
        "name": "SOCSO",
        "what": "Social security matters."
      },
      {
        "name": "Warnings",
        "what": "Disciplinary record and attendance problems."
      },
      {
        "name": "Benefits",
        "what": "Medical and other benefits."
      },
      {
        "name": "Group history",
        "what": "Every time this person worked in the group, and the rehire decision."
      }
    ],
    "tasks": [
      {
        "task": "How to find someone",
        "steps": [
          "Type in \"Search name or staff number\".",
          "Press their name."
        ]
      },
      {
        "task": "How to see who cannot work",
        "steps": [
          "Press \"Not allowed\".",
          "Open a person; read \"Can this guard work today?\" on \"Work\"."
        ]
      },
      {
        "task": "How to add office staff",
        "steps": [
          "Press \"Add office staff\".",
          "Fill in the form and press \"Save\"."
        ]
      },
      {
        "task": "How to set a PIN",
        "steps": [
          "Open the person, tab \"Work\".",
          "Under \"PIN and Prima access\" type 4 to 6 digits.",
          "Press \"Set PIN\". Tell them in private."
        ]
      },
      {
        "task": "How to close a leaver's access",
        "steps": [
          "Open the person.",
          "Press \"Close access\", give a reason and date.",
          "Press \"Close access\" again."
        ]
      },
      {
        "task": "How to look up someone's history before hiring",
        "steps": [
          "Press \"Look up staff history\".",
          "Type the \"IC or passport\" and choose \"Nationality\".",
          "Press \"Look up\". A red notice shows if they are not to be hired again."
        ]
      },
      {
        "task": "How to enrol a guard's own phone",
        "steps": [
          "Open the guard, tab \"Work\", find \"Own phone sign-in (face plus PIN)\".",
          "Press \"Enrol phone\" (or \"Code for a new phone\").",
          "Press \"Copy link\" and send it to the guard's own phone only.",
          "To stop it press \"Retire phone\", give a reason, press \"Retire\"."
        ]
      },
      {
        "task": "How to handle an appeal against a warning",
        "steps": [
          "Open the guard, tab \"Warnings\".",
          "Press \"Record the guard's appeal\", write the grounds, choose the language, press \"Send appeal\".",
          "The HR Director or CEO chooses the decision, writes \"Reasons in writing (needed)\" and presses \"Decide appeal\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "KDN guard card",
        "means": "The guard licence from the Home Ministry."
      },
      {
        "term": "CSG",
        "means": "Guard training that must be done in the first year."
      },
      {
        "term": "FOMEMA",
        "means": "Medical check for foreign workers."
      }
    ],
    "notes": "Guards and officers come from the JA Group app; office staff are added here. \"Not recorded yet\" means HR has not entered that fact. Add, Import, Set PIN, Close access and the phone card only show to people allowed. A history lookup is recorded with the masked number."
  },
  {
    "view": "attendance",
    "title": "Attendance",
    "what": "The daily attendance sheet: who clocked in, who is absent or late, alerts to the PIC, follow-up actions, leave requests and monthly reports.",
    "who": "Directors and group staff, company managers, admin executives and supervisors. Buttons to act on an alert show only to the PIC and people allowed to follow up, replace or discipline.",
    "tabs": [
      {
        "name": "Day sheet",
        "what": "Every shift of the day, problems and live alerts."
      },
      {
        "name": "Absence and discipline",
        "what": "Absences of the last 14 days, discipline and every action taken."
      },
      {
        "name": "Leave requests",
        "what": "Leave and absence requests waiting for a decision."
      },
      {
        "name": "Monthly reports",
        "what": "Imported monthly attendance reports."
      }
    ],
    "tasks": [
      {
        "task": "How to act on an alert",
        "steps": [
          "Press the alert.",
          "Choose \"Guard contacted\", \"Send replacement\", \"Excuse\" or \"Discipline\".",
          "Write the note; attach proof if asked.",
          "Press \"Record\"."
        ]
      },
      {
        "task": "How to lock a day",
        "steps": [
          "Pick \"Yesterday\" or an earlier day.",
          "Check the records.",
          "Press \"Lock ...\" with the day."
        ]
      },
      {
        "task": "How to decide a leave request",
        "steps": [
          "Open \"Leave requests\".",
          "Press \"Decide\", write a note.",
          "Press \"Approve\" or \"Reject\"."
        ]
      },
      {
        "task": "How to see every shift",
        "steps": [
          "Untick \"Only show problems\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "PIC",
        "means": "The person in charge who gets the alert."
      },
      {
        "term": "Not on roster",
        "means": "Someone clocked in without a shift."
      },
      {
        "term": "Lock",
        "means": "Close the day after checking."
      }
    ],
    "notes": "Clock-ins come only from the site device, never typed here. Nothing pays, deducts or disciplines automatically. Only past days can be locked. \"You can see this alert but not act on it\" means the company's PIC acts. For staff leave the buttons may read \"Authorise\" or \"Consent\" instead of \"Approve\". \"Import timesheet (PDF, Excel, CSV)\" shows only to HR, the company manager or the owner; it shows every person, the dates and the totals, and what to check, before \"Save\"."
  },
  {
    "view": "cases",
    "title": "Cases",
    "what": "Incidents, complaints and alerts in one place. Each case has a response clock set by its severity, and only the company closes a case.",
    "who": "Directors, group officers, company managers, admin executives and supervisors. Group leaders get an \"All companies\" / \"Selected company\" switch. Company managers and admin executives also see \"Police call or visit help\". Some people can only look at a case: they see \"You can see this case but not change it.\"",
    "tabs": [],
    "tasks": [
      {
        "task": "How to raise a case",
        "steps": [
          "Press \"Raise a case\".",
          "If you work for more than one company, choose the \"Company\".",
          "Choose the \"Site\" (or \"Company-wide (no site)\"), the \"Type\" and the \"Severity\".",
          "Type a short \"Title\" and \"What happened\".",
          "Add proof: a photo (when a site is chosen) or a document. An SOS can go without proof.",
          "Press \"Raise case\"."
        ]
      },
      {
        "task": "How to find the cases waiting for me",
        "steps": [
          "Press \"Waiting for me\" (the number shows how many).",
          "Rows marked \"Your turn\" need your sign-off; \"You may step in\" means you are allowed to help.",
          "Use the search box, \"All severities\" and \"All sites\" to narrow the list; \"Open\" or \"All\" shows unresolved or every case."
        ]
      },
      {
        "task": "How to update a case",
        "steps": [
          "Tap the case to open it.",
          "Under \"Update this case\", write a \"Note\".",
          "Press \"Acknowledge\", \"Escalate\", \"Resolve\" or \"Add note\". \"Resolve\" needs proof first."
        ]
      },
      {
        "task": "How to sign off on the escalation ladder",
        "steps": [
          "Open the case and look at \"Escalation until fully resolved\".",
          "Write what you checked or what was done.",
          "Press \"Verify, pass up\", \"Resolved, pass up\", \"Send back\", \"Escalate higher\" or \"Confirm fully resolved\". Verify, resolve and confirm need a photo or a document as proof."
        ]
      },
      {
        "task": "How to ask Arms Control for help with a police call or visit",
        "steps": [
          "Under \"Police call or visit help\", press \"Ask Arms Control for help · Minta bantuan\".",
          "Choose what is happening (phoned, coming now, or a set date), what the police want, the station or unit and what they asked, then \"Who Arms Control should call\" and \"Work phone\".",
          "Press \"Send to Arms Control\" and keep your phone near you.",
          "After the help, press \"Confirm or send back\", write a comment and press \"Confirm help received\" or \"Send back to Arms Control\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "P1 / P2 / P3 / P4",
        "means": "Severity. P1: respond in 5 minutes. P2: respond in 30 minutes. P3: respond today. P4: respond in 2 working days."
      },
      {
        "term": "Response late",
        "means": "The response clock for this case has run out."
      },
      {
        "term": "Proof",
        "means": "A stamped photo or a document kept with the case. Every case needs one."
      },
      {
        "term": "Step in",
        "means": "A higher level signs off in place of the person whose turn it is."
      }
    ],
    "notes": "\"Resolve\" and the verify/confirm buttons stay greyed out until proof is added. Only the company closes a case: \"Close case\" shows once it is resolved; if you do not see it, it waits for the Company Manager. \"Take photo\" only shows when the case belongs to a site. The \"Incident\" type may be missing when incidents are reported in the JA Group app instead. \"What to say and show · Panduan\" opens a short police guide. If no buttons show inside a case, you can view it but not change it."
  },
  {
    "view": "compliance",
    "title": "Licences",
    "what": "A calendar of each company's licences: KDN licence, MOF registration, group insurance and SSM annual return, with expiry dates. A person does the filing; the app keeps the date and receipt.",
    "who": "Directors, group officers, company managers and admin executives. You see the companies you can see. \"Add licence\", \"Import\", \"Update\" and \"Add record\" only show for people allowed to record licences.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to see what needs action",
        "steps": [
          "Press \"Needs action\" (the default). It hides valid licences.",
          "Tap a box at the top (\"Expired\", \"No record\", \"Due soon\", \"Valid\") to show only those.",
          "Press \"Clear filter\" to go back."
        ]
      },
      {
        "task": "How to update a licence after renewal",
        "steps": [
          "Find the licence (search \"Search company or licence\").",
          "Press \"Update\" on its row.",
          "Fill in the new details and save."
        ]
      },
      {
        "task": "How to add a missing licence record",
        "steps": [
          "Press \"Add record\" on a row that says \"No record\", or \"Add licence\" at the top.",
          "Fill in the form and save."
        ]
      },
      {
        "task": "How to see one company's licences together",
        "steps": [
          "Press \"By company\" (instead of \"By urgency\")."
        ]
      },
      {
        "task": "How to load many licences at once",
        "steps": [
          "Press \"Import\" and follow the steps."
        ]
      }
    ],
    "terms": [
      {
        "term": "No record",
        "means": "The app has no date for this licence. It counts as a problem until it is found."
      },
      {
        "term": "Due soon",
        "means": "Inside the reminder window. Reminders start 120, 90, 90 and 60 days before expiry."
      },
      {
        "term": "Pilot",
        "means": "A company in the trial group."
      }
    ],
    "notes": "If the list says \"Nothing needs action.\", every licence is valid; press \"All\" to see them. If the add and update buttons are missing, your account is not allowed to record licences."
  },
  {
    "view": "settings",
    "title": "Settings",
    "what": "One list of every setting staff enter in Prima: rates, pay rules, public holidays, allowances, approval limits, staff and desks, and the email and report settings. Each shows who keeps it and whether it is set yet.",
    "who": "Office staff and leaders. You see whether a setting is set for the settings your job keeps or oversees; for the others you see who keeps them.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find what is not set yet",
        "steps": [
          "Press \"Still to do\" at the top.",
          "Read the owner on each line.",
          "If you are the owner, press \"Open\" to go to the screen and enter it."
        ]
      },
      {
        "task": "How to find one setting",
        "steps": [
          "Type a word in \"Search settings\", for example holiday or rate.",
          "Press \"Open\" on the line."
        ]
      }
    ],
    "terms": [
      {
        "term": "Not set",
        "means": "The screen is there but nothing is entered yet."
      },
      {
        "term": "Not installed",
        "means": "The database part for it is not installed yet; IT installs it with the CEO."
      },
      {
        "term": "Server setting, off",
        "means": "Kept by IT on the server and switched off until the CEO says."
      }
    ],
    "notes": "Amounts are never shown here; open the screen to see them. \"Owner sees it\" means only the owner and group leaders see whether it is set."
  },
  {
    "view": "selfaudit",
    "title": "Yearly self-audit",
    "what": "Each company checks itself once a year: the company office, each site, or everything at once. Prima reminds you before it is due and keeps what was found and fixed.",
    "who": "The company manager and the company's admin executives do the self-audit for their company. ACT and directors can see it. It is for the company chosen at the top.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to do a self-audit",
        "steps": [
          "Press \"Do a self-audit\".",
          "Choose \"Company and all sites\", \"Company office\" or \"One site\".",
          "For each item press \"OK\", \"Not right\" or \"N/A\". For Not right or N/A, type why.",
          "Add documents if you have them.",
          "Press \"Save self-audit\" once every item is answered."
        ]
      },
      {
        "task": "How to record a fix",
        "steps": [
          "Under \"Self-audits done\", open the audit.",
          "On an item marked \"Not right\" press \"Record fix\".",
          "Write what was done, add proof, and save."
        ]
      },
      {
        "task": "How to see a site's client requirements",
        "steps": [
          "In \"Where it stands\", press \"Client requirements\" next to the site."
        ]
      }
    ],
    "terms": [
      {
        "term": "Due now / Overdue",
        "means": "The yearly self-audit for that place is due or late."
      },
      {
        "term": "N/A",
        "means": "The item does not apply here; you must say why."
      }
    ],
    "notes": "No \"Do a self-audit\" button means you can only view: the company manager or the company's admin executives do it. The save button stays grey until every item is answered. Self-audits and client requirements are a newer database module; where it is not installed yet, no self-audit reminders appear."
  },
  {
    "view": "rba",
    "title": "RBA readiness",
    "what": "Records for the RBA Code checklist: monthly targets, red items, site safety checks, the yearly committee, the trace review, worker files and the yearly ethics declaration. It is not a certificate.",
    "who": "ACT, group leaders, HR, FWM, the Operations Director, company managers, admin executives and OMs up to OGM. What you see depends on your role. Everyone in the office signs the yearly ethics declaration. The Chief of Staff or Deputy names the committee.",
    "tabs": [
      {
        "name": "Dashboard",
        "what": "The chosen company's monthly targets."
      },
      {
        "name": "Red items",
        "what": "Gaps graded red on a site's RBA list."
      },
      {
        "name": "Site checks",
        "what": "The monthly site safety check for each site with an RBA list."
      },
      {
        "name": "Committee",
        "what": "This year's RBA committee members."
      },
      {
        "name": "Trace review",
        "what": "ACT's monthly trace of workers' records."
      },
      {
        "name": "Worker files",
        "what": "Each foreign worker's file folders, and guards with no signed contract."
      },
      {
        "name": "Ethics declaration",
        "what": "Your own yearly ethics declaration, and the list for reviewers."
      }
    ],
    "tasks": [
      {
        "task": "How to sign my ethics declaration",
        "steps": [
          "Open \"Ethics declaration\".",
          "Tick every statement.",
          "Write any interests that could conflict with your work, or tick \"I have no such interests\".",
          "Press \"Sign\"."
        ]
      },
      {
        "task": "How to name the RBA committee (Chief of Staff or Deputy)",
        "steps": [
          "Open \"Committee\".",
          "Press \"Name the committee\" (or \"Change members\").",
          "Pick the members and press \"Save\"."
        ]
      },
      {
        "task": "How to run a trace review (ACT)",
        "steps": [
          "Open \"Trace review\".",
          "Choose the month and press \"Run the trace\".",
          "For each mismatch write what was found and press \"Explained\", \"Corrected\" or \"Finding\"."
        ]
      },
      {
        "task": "How to review a declared interest (ACT)",
        "steps": [
          "In the ethics list, write the review note.",
          "Press \"No conflict\" or \"Managed\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "UNKNOWN",
        "means": "Nothing to count yet. It is never shown as green."
      }
    ],
    "notes": "If your role has no RBA access, the page shows only your ethics declaration. Operations sees only site checks, the committee and the ethics declaration. The site inspection itself is done on the site's client requirements page by the OM who covers the site."
  },
  {
    "view": "commercial",
    "title": "Tenders & quotes",
    "what": "The page for the company's bids: tenders, quotations and new leads. It also shows whether the company can bid today, the tenders and quotations the Director Office found, and a count of tenders and quotations.",
    "who": "Directors, group officers, company managers and admin executives. The company admin team prepares tenders and quotations; the Company Manager approves quotations and decides won, lost or no bid. People who cannot prepare only view (\"You can view this tender. The company's admin team and manager update it.\"). The \"Joint tenders\" box shows only for company managers and admin executives, and only when a joint tender exists.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to add a new tender",
        "steps": [
          "Press \"Add tender\" at the top.",
          "Fill in \"Tender reference\", choose \"Government\" or \"Private\", then \"Title\", \"Buyer\" and \"Closing date\".",
          "Fill in \"Guards needed\" and \"Sites\". \"Where it came from\", \"Estimated value\" and \"Leads the pursuit\" are optional.",
          "Tick the armed guards box if the work needs armed guards.",
          "Press \"Add tender\" to save. The tender opens so you can follow its protocol."
        ]
      },
      {
        "task": "How to work on a tender",
        "steps": [
          "In \"Tender pipeline\", tap the tender card (columns: Open, Preparing, Submitted, Decided).",
          "Check \"Can this company bid today?\" to see if any paper blocks the bid.",
          "Work through \"Tender papers\", \"Questions to the buyer\", \"Tender guide\", \"Tender checklist\", \"Bid files\" and \"Signatures and submission\".",
          "Press \"Start preparing\" when the protocol steps are done."
        ]
      },
      {
        "task": "How to make a quotation",
        "steps": [
          "Press \"New quotation\" (or \"Prepare quotation\" inside a tender).",
          "Fill in \"Client\", \"Site\", \"For tender\" (or \"Direct quotation (no tender)\"), \"Guards\", \"Shift length\", \"RM per guard a month\" and \"Valid for (days)\".",
          "Press \"Save draft\".",
          "Open the quotation and press \"Send to manager for approval\"."
        ]
      },
      {
        "task": "How the manager approves a quotation",
        "steps": [
          "Under \"Quotations\", tap a quote marked \"Waiting for approval\".",
          "Write a note. A comment is needed to approve (a short one is fine) and to return it.",
          "Press \"Approve\", or press \"Return for changes\".",
          "After approval the admin team presses \"Mark sent to client\", then \"Client accepted\" or \"Client rejected\"."
        ]
      },
      {
        "task": "How to enter a tender or quotation the Director Office found",
        "steps": [
          "Scroll to \"Tenders and quotations found (peluang)\".",
          "If the Director Office set your company to enter one, press \"We are entering this\". The Director Office is informed.",
          "To tell them about one you found, press \"Tell the Director Office\", fill in \"Kind\", \"Government or private\", \"Closes on\", \"Title\" and \"Buyer or client\", then press \"Save\". No approval is needed."
        ]
      },
      {
        "task": "How to record a new lead",
        "steps": [
          "In \"Leads and client research\", press \"New lead\".",
          "Fill in the prospect details and press \"Open lead\".",
          "On the lead, use \"Research\", \"Site survey\", \"Link quotation\", \"Note or next step\" or \"Close\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Tender",
        "means": "A formal invitation from a buyer (often government) to bid for guarding work."
      },
      {
        "term": "No bid",
        "means": "The company decided not to bid for that tender."
      },
      {
        "term": "MOF",
        "means": "Ministry of Finance registration; government tenders also need it."
      },
      {
        "term": "Peluang",
        "means": "A tender or quotation opportunity that was found and may be entered."
      },
      {
        "term": "Tender and quotation counter",
        "means": "Counts of tenders entered and won and quotations sent and accepted. Counts only, not a ranking."
      }
    ],
    "notes": "\"Add tender\" and \"New quotation\" only show for people allowed to add tenders or prepare quotes. \"Start preparing\" stays greyed out until the protocol steps are done; the page lists what is still to do. You cannot approve a quotation you prepared yourself; another person must approve it. \"Approve\" stays greyed out until a note is written. Prices are typed in by hand: automatic cost checks (minimum wage, overtime, EPF, SOCSO, EIS) are not on yet. The bid itself is lodged on the buyer's portal by an authorised person; the app only records it."
  },
  {
    "view": "ops",
    "title": "Regional ops",
    "what": "A board for the regional operations team: who is on duty, no-shows, shifts with no guard, patrol gaps and open cases for every company with sites in your region. You see and follow up; each company decides its own rosters.",
    "who": "Directors and group officers in Operations. What you see depends on your operations level: a region, or nationwide, and sometimes only government or private sites. Vacancies show for Ops Managers and Regional OMs; \"Management fee bills (draft)\" shows for the OGM, the Operations Director and the COO.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to follow up the most urgent problems",
        "steps": [
          "Look at \"Needs follow-up now\" (most urgent first).",
          "Tap a row. A case opens in Cases; anything else opens the site."
        ]
      },
      {
        "task": "How to look at another region",
        "steps": [
          "Use the \"Region\" list at the top (only shown if you cover more than one)."
        ]
      },
      {
        "task": "How to open a company's sites",
        "steps": [
          "In \"Companies in the region\", tap the company's row."
        ]
      },
      {
        "task": "How to see empty shifts for the week",
        "steps": [
          "Read \"Shifts with no guard, next 7 days\". The company fills them; you chase."
        ]
      },
      {
        "task": "How to check site profit, pay and leave",
        "steps": [
          "Scroll to \"Government sites: profit, pay and leave\" or \"Private sites: profit, pay and leave\".",
          "Choose the month, then pick \"Site profit and loss\", \"Salary check\", \"Guards on leave\" or \"Client satisfaction\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "No-show",
        "means": "A guard who did not turn up for a shift."
      },
      {
        "term": "Patrol gap",
        "means": "A site with no NFC patrol tap for several hours."
      },
      {
        "term": "Patrolling officer",
        "means": "An officer who covers several sites, with a limit on how many guards each."
      }
    ],
    "notes": "Companies with no site data in Prima yet are listed under \"... no site data in Prima yet, so their numbers are unknown\"; their numbers are unknown, not zero. A notice at the top may point to Site man-hours; press \"Open\" to go there. The leave and absence requests from guards and officers are also on this page."
  },
  {
    "view": "hr",
    "title": "HR monitor",
    "what": "Workforce papers for every company plus the HR work queues: pay changes, joining and leaving, staff history, cases, discipline appeals, screening, training, leave, CMS staff hours and attendance reports. Each company is the employer and makes the change.",
    "who": "Directors and group officers in HR. Each work panel hides itself when it does not apply to you.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to jump to a work queue",
        "steps": [
          "Press a button under the numbers: \"Workforce papers\", \"Pay and allowances\", \"Joining, leaving and moving\", \"Cases, safety and legal\", \"Appraisals, training and policies\", \"Leave and holidays\" or \"Attendance reports\"."
        ]
      },
      {
        "task": "How to verify a pay change",
        "steps": [
          "In \"Pay and allowances\", find it in \"Pay and salary account changes to verify\" and press \"Verify\".",
          "Write a comment (a comment is needed to verify or reject), then press \"Verify\" or \"Reject\". It then waits for the Vice Chairman's consent."
        ]
      },
      {
        "task": "How to check someone's history in the group before hiring",
        "steps": [
          "In \"Joining, leaving and moving\", find \"Look up staff history\".",
          "Type the \"IC or passport\", choose the \"Nationality\" and press \"Look up\". The number is not kept.",
          "To mark the person, choose \"Your decision\", write the \"Reason\", type the IC or passport again and press \"Save decision\"."
        ]
      },
      {
        "task": "How to decide a guard's discipline appeal (HR Director or CEO)",
        "steps": [
          "In \"Cases, safety and legal\", find \"Guard discipline appeals\".",
          "Choose the \"Decision\", write the reasons (needed) and press \"Decide appeal\"."
        ]
      },
      {
        "task": "How to screen a person",
        "steps": [
          "In \"Cases, safety and legal\", find \"Screening\" and use \"Open a screening case\", then \"Open case\".",
          "Record each check with the authority's reference and press \"Save check\".",
          "The HR Director chooses \"Your decision\", writes the reason and presses \"Record decision\", never on a case they opened."
        ]
      }
    ],
    "terms": [
      {
        "term": "Cannot work today",
        "means": "A rule blocks this person from working, for example missing papers."
      },
      {
        "term": "KDN",
        "means": "The security guard card or submission from the Home Ministry."
      },
      {
        "term": "Group employment history",
        "means": "One person across the group's companies, linked by IC or passport."
      }
    ],
    "notes": "A company with no staff data shows under \"Unknown: staff data not loaded yet\"; unknown, not fine. \"CMS staff hours\" is view only; Arms Control sets the CMS roster. If a panel is missing, it does not apply to your role."
  },
  {
    "view": "insurance",
    "title": "Insurance",
    "what": "Keeps track of each company's insurance policies, premiums, insurance claims and bank guarantees, and lists what needs chasing.",
    "who": "Directors, group officers, company managers and admin executives, mainly the Chief of Staff's insurance section. Directors and group officers see every company and the \"Companies unknown\" box. Paying a premium, signing a guarantee or accepting a settlement stays with the company's board and Finance.",
    "tabs": [
      {
        "name": "To chase",
        "what": "The most urgent insurance items to follow up, most urgent first."
      },
      {
        "name": "Policies",
        "what": "Every policy with its insurer, cover, dates, premium and renewal state. Renew or cancel here."
      },
      {
        "name": "Premiums",
        "what": "Premiums unpaid and overdue, due soon, not due yet, or paid with Finance's reference."
      },
      {
        "name": "Claims",
        "what": "Insurance claims and the step each one has reached."
      },
      {
        "name": "Guarantees",
        "what": "Bank guarantees and bonds, and whether they must be extended or released."
      },
      {
        "name": "Companies",
        "what": "Each company's cover at a glance, including missing or lapsed cover."
      },
      {
        "name": "History",
        "what": "Renewed and cancelled policies, kept on the register but no longer counted as cover."
      }
    ],
    "tasks": [
      {
        "task": "How to add a policy",
        "steps": [
          "Choose the company at the top of the app.",
          "Press \"Add policy\" (the company code is shown in brackets).",
          "Fill in the form and save."
        ]
      },
      {
        "task": "How to record a premium payment",
        "steps": [
          "On the \"Premiums\" tab, find the policy and press \"Record payment\".",
          "Fill in \"Date paid\" and \"Payment reference\" (from Finance), then press \"Save\". A date alone is not proof of payment."
        ]
      },
      {
        "task": "How to renew or cancel a policy",
        "steps": [
          "On the \"Policies\" tab, find the policy.",
          "To renew, press \"Renew\", fill in \"New policy number\", check the dates and premium, and press \"Save renewal\". Next year is added as a new record.",
          "To cancel, press \"Cancel policy\", fill in \"Cancelled from\" and \"Reason\", and press \"Confirm cancel\".",
          "The old record moves to \"History\"."
        ]
      },
      {
        "task": "How to record a new claim",
        "steps": [
          "Press \"Record claim\" at the top, or \"Add claim\" on the \"Claims\" tab.",
          "Fill in the form and save."
        ]
      },
      {
        "task": "How to move a claim to its next step",
        "steps": [
          "On the \"Claims\" tab, press \"Steps\" on the claim.",
          "If the insurer is not told yet, fill in \"Date the insurer was told\", \"Insurer claim reference\" and \"How\", then press \"Record insurer told\".",
          "Add each paper with \"Add document\", then press \"Sent for assessment\".",
          "When the insurer offers money, press \"Record offer\". The company manager then presses \"Accept offer for the company\" and Finance presses \"Record money received\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Premium",
        "means": "The money paid to the insurer to keep the cover running."
      },
      {
        "term": "Guarantee / bond",
        "means": "A bank promise given to a client; it must stay valid until the contract ends."
      },
      {
        "term": "Adjuster",
        "means": "The insurer's person who checks a claim before an offer is made."
      }
    ],
    "notes": "Add, edit, renew and cancel only show for people allowed to keep those records; \"Renew\" shows when cover needs renewing. \"Paid, no reference\" means a date was recorded without Finance's reference. \"Sent for assessment\" stays greyed out while usual documents are missing. Prima does not contact the insurer, accept offers or receive money; staff record each step. A rejected claim can be appealed once with \"Appeal (once)\". \"Import\" loads many records at once. \"Unknown\" means no records loaded yet."
  },
  {
    "view": "arms",
    "title": "Arms control",
    "what": "Tracks firearms, vaults, ammunition and every time a firearm is issued to a guard and returned. The paper register book stays in use beside the app.",
    "who": "Directors, group officers in Arms Control, company managers and supervisors. Directors and group officers see the group \"Arms control\" board with its tabs; the \"Companies\" tab shows each company's register. Company staff see their own company's register. Supervisors see only firearms at their own sites and with their own people, and do not see \"Armed jobs\" or \"Arms requests\". Only the company's manager or the site supervisor issues, receives and counts firearms. \"CMS management\" shows for directors and Arms Control staff.",
    "tabs": [
      {
        "name": "Alerts",
        "what": "What the CMS arms desk is watching now."
      },
      {
        "name": "Readiness",
        "what": "Who is cleared for armed duty in the next 24 hours."
      },
      {
        "name": "Vaults",
        "what": "Vault watch, alarms and door events."
      },
      {
        "name": "In and out",
        "what": "Firearms issued and returned, last 24 hours."
      },
      {
        "name": "Ammunition",
        "what": "Rounds by vault and short returns."
      },
      {
        "name": "Armed jobs",
        "what": "Cash and close protection jobs."
      },
      {
        "name": "Requests",
        "what": "Requests to buy, service, dispose of or report loss."
      },
      {
        "name": "Renewals",
        "what": "Licences, permits and servicing due."
      },
      {
        "name": "Client agreements",
        "what": "Client arms agreements."
      },
      {
        "name": "Police visit help",
        "what": "Companies asking for help with a police call or visit."
      },
      {
        "name": "Police and KDN",
        "what": "Missing firearm reports and deposits."
      },
      {
        "name": "Tenders",
        "what": "Tenders that need arms."
      },
      {
        "name": "Suppliers",
        "what": "Arms suppliers and items."
      },
      {
        "name": "Trading",
        "what": "Arms trading and import (off unless the CEO switches it on)."
      },
      {
        "name": "Companies",
        "what": "Each company's firearm counts and register."
      },
      {
        "name": "Legal points (directors)",
        "what": "Legal points for group directors only."
      }
    ],
    "tasks": [
      {
        "task": "How to issue a firearm for an armed shift",
        "steps": [
          "Under \"Armed shifts needing a firearm\", press \"Issue firearm\".",
          "Hold the firearm to the reader in \"Scan RFID tag\", or pick it in \"Firearm\".",
          "Fill in \"Rounds issued\" and have the witness sign in.",
          "Press \"Issue and record\"."
        ]
      },
      {
        "task": "How to receive a firearm back",
        "steps": [
          "Under \"Firearms out now\", press \"Receive back\".",
          "Scan the tag, count every round and fill in \"Rounds returned\".",
          "Have the witness sign in, then press \"Receive into vault\"."
        ]
      },
      {
        "task": "How to count a vault",
        "steps": [
          "Under \"Vaults\", press \"Count now\".",
          "Count what is physically there and fill in \"Firearms counted in the vault\".",
          "Have the witness sign in and press \"Record count\"."
        ]
      },
      {
        "task": "How to plan an armed job",
        "steps": [
          "Under \"Armed jobs\", press \"Plan an armed job\".",
          "Choose \"Kind of job\", fill in \"Client\", \"Route or location\", \"Starts\" and \"Ends\".",
          "Tick the crew and the states the job passes through.",
          "Press \"Book the job\". Later use \"Update\" to mark it \"Started\", \"Delayed\", \"Incident\" or \"Completed\"."
        ]
      },
      {
        "task": "How to help a company with a police call or visit",
        "steps": [
          "Open \"Police visit help\" and press \"Assign helper\" on the request.",
          "Fill in \"Helper\", \"Helper's work phone\" and \"How\" (\"By phone\" or \"Going there\"), press \"Save helper\", then call the company.",
          "Afterwards press \"Record help given\", write what happened, add proof such as the register page the police signed, and press \"Save\". The company confirms."
        ]
      }
    ],
    "terms": [
      {
        "term": "RFID tag",
        "means": "A small chip on the firearm that the vault reader scans."
      },
      {
        "term": "P1 case",
        "means": "A top-priority case, opened at once when rounds or counts differ or a firearm is very late."
      },
      {
        "term": "Unverified",
        "means": "A firearm whose whereabouts are not confirmed; never counted as secure."
      }
    ],
    "notes": "If the RFID reader does not work you can choose by hand, but it is recorded as not scanned. The app stops an issue if the guard's permit, roster, firearm licence or vault approval fails. A count or return that does not match opens a P1 case; the register is never changed to fit. Serial numbers are masked. Arms trading and import stay off until the CEO turns them on. Arms requests start with \"New arms request\". People without handling rights see \"You can view this.\""
  },
  {
    "view": "cms",
    "title": "CMS",
    "what": "The \"CMS command centre\": the 24-hour centre that watches every site of every company. It covers guard attendance and patrols, CCTV, emergencies and incidents, site shared devices and every company's IP phones.",
    "who": "CMS staff, Arms Control, and the COO or higher (plus directors). Arms Control sets the roster and the settings. Buttons to act (acknowledge alarms, record handover, call back) show only for the CMS desk. CMS watches and escalates; the company decides.",
    "tabs": [
      {
        "name": "Now",
        "what": "\"To act on\", who is \"On shift now\", the shift handover, your \"My seat\" card and police help requests (view only)."
      },
      {
        "name": "Emergencies and incidents",
        "what": "Alarms such as Guard SOS, panic, intrusion and fire, false alarms to review, and open incidents at sites."
      },
      {
        "name": "Site devices",
        "what": "Send a message to a site's shared device and check the guard's photo or video proof."
      },
      {
        "name": "Sites",
        "what": "Attendance alerts to the PIC, each site's attendance, patrol and CCTV state, and response figures for the last 24 hours."
      },
      {
        "name": "Phone desk",
        "what": "Missed forwarded calls, calls by company, extensions and today's calls."
      },
      {
        "name": "Guard phones",
        "what": "Guards signed in on their own phones: live, late or offline, and SOS from a phone."
      },
      {
        "name": "Roster",
        "what": "CMS shifts and who sits Head Control and Monitor Officer on each."
      },
      {
        "name": "Settings",
        "what": "Shift pattern and time limits for CMS; only Arms Control can change them."
      },
      {
        "name": "What CMS does",
        "what": "CMS duties and whether each works in the app yet."
      },
      {
        "name": "Staff",
        "what": "CMS staff, posts, console extension, linked Prima account and \"Hours this month\"."
      },
      {
        "name": "Commissioning",
        "what": "Check each contract's signed CMS service: verify contacts by test call and record tests per site."
      }
    ],
    "tasks": [
      {
        "task": "How to handle an alarm",
        "steps": [
          "Open \"Emergencies and incidents\".",
          "Tap the alarm in the list.",
          "Press \"Acknowledge\", then check the camera and call the guard.",
          "Type in \"What was checked\".",
          "Press \"Real: open incident\" or \"False alarm\"."
        ]
      },
      {
        "task": "How to start and end your CMS seat",
        "steps": [
          "On \"Now\", in \"My seat\", press \"Clock in\".",
          "Head Control: read \"Take the handover\", write what you checked, and press \"Agree and take over\" or \"Take over, not agreed\" (Arms Control is told).",
          "In your last hour, Head Control writes what is still open and presses \"Write handover\", then stays until the next Head Control takes it.",
          "Press \"Clock out\". If leaving early, type why first."
        ]
      },
      {
        "task": "How to log a call-back",
        "steps": [
          "Open \"Phone desk\".",
          "In \"Call back\", find the missed call.",
          "Type what they needed and who it was passed to.",
          "Press \"Called back\"."
        ]
      },
      {
        "task": "How to send a site device to check something",
        "steps": [
          "On \"Site devices\", fill in \"Site\", \"Level\", \"Proof the guard sends\", \"Title\" and \"What the guard must do\".",
          "Press the send button (it is named after the level).",
          "When proof comes back, add a note and press \"Real: open incident\", \"Nothing found\" or \"Done\"."
        ]
      },
      {
        "task": "How to put someone on a CMS seat",
        "steps": [
          "On \"Roster\", press \"Plan next week\" if the days are missing.",
          "On a seat, choose a name and press \"Set\".",
          "To take someone off before they clock in, type why and press \"Take off\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Head Control",
        "means": "The senior CMS person on a shift. Each shift needs at least one."
      },
      {
        "term": "Monitor Officer",
        "means": "The CMS person who watches screens and alarms on a shift."
      },
      {
        "term": "PIC",
        "means": "The person in charge at the company who gets attendance alerts."
      }
    ],
    "notes": "Only CMS, Arms Control, the COO or higher see this page. Action buttons show only for the CMS desk; Settings say \"Only Arms Control can change these.\" Head Control reviews every false alarm; \"Agree, false\" needs a note. AI and sensor detections are \"Feed not connected yet: test detections only.\" A Commissioning contact cannot verify their own number; another operator must."
  },
  {
    "view": "cmsready",
    "title": "CMS site readiness",
    "what": "A checklist of each site's devices and preparations before it can be linked to the CMS. It only records readiness; nothing here connects a device.",
    "who": "Directors, group leaders, Arms Control, CMS, operations, company managers, admin executives and supervisors (own sites). The company manager, admin executives, supervisors and Arms Control record. An OM or Regional OM records only when acting for the company in their region. Arms Control checks.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find a site",
        "steps": [
          "Type in \"Search site, client or company\".",
          "Or pick a status such as \"Needs fixing\" or \"Waiting for check\".",
          "Press the site's row to open it."
        ]
      },
      {
        "task": "How to add a device",
        "steps": [
          "Open the site and press \"Add device\".",
          "Fill in \"Kind\", \"Brand the client chose\", \"Model\", \"How many\", \"Owner\" and \"Where the client chose the brand\".",
          "Add the \"Installer or vendor\" and \"Vendor phone\" if known.",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to answer a checklist item",
        "steps": [
          "Under \"Checklist\" press \"Answer\".",
          "Choose \"Yes\", \"No\" or \"Not known yet\" and add a note or reference.",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to check a site (Arms Control)",
        "steps": [
          "Open the site and go to \"Arms Control check\".",
          "Write \"Your reason\".",
          "Press \"Pass\", or \"Return with what to fix\"."
        ]
      },
      {
        "task": "How to remove a device",
        "steps": [
          "Press \"Edit\" on the device.",
          "Type \"Why remove it\" and press \"Remove device\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Ready to connect",
        "means": "The site is prepared and checked. It is not linked yet."
      },
      {
        "term": "Not known yet",
        "means": "Nobody has answered this; it is never counted as done."
      }
    ],
    "notes": "The device brand is the client's choice. Never type a password, PIN or code here; record only who holds the login. \"Connected\" stays at zero because connections come later. If you recorded part of a site, another Arms Control officer must check it. Without record rights the \"Add device\" and \"Answer\" buttons are hidden."
  },
  {
    "view": "audit",
    "title": "Audit trail",
    "what": "A read-only log of every change in Prima: who did what, to which record, and when. Each entry is sealed to the one before it, so a later edit would show as a broken seal.",
    "who": "Directors, group officers and company managers. Nobody can add or edit an entry here; Prima writes them itself.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find a change",
        "steps": [
          "Type in \"Search what, who, record or entry number\".",
          "Narrow it with the \"Everyone\" list (who) and the \"All areas\" list.",
          "Press \"Show ... more\" at the bottom to load older entries."
        ]
      },
      {
        "task": "How to read one entry",
        "steps": [
          "Tap the entry. A panel shows \"Who\", \"When\", \"What\", \"Record\", \"Company\" and \"Entry\", plus its seal."
        ]
      },
      {
        "task": "How to check the log was not tampered with",
        "steps": [
          "Look at the \"Seal\" box at the top: \"Intact\" is good; \"Broken\" shows the entry where it broke."
        ]
      },
      {
        "task": "How to clear the search",
        "steps": [
          "Press \"Clear search and filters\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Seal",
        "means": "A code linking each entry to the one before it, so any later edit is detectable."
      },
      {
        "term": "Group-wide",
        "means": "A change not tied to one company."
      }
    ],
    "notes": "The page shows the latest entries, not the whole log; the top box says how many of the total. If the seal box says \"Seal checked by PWVSB\", the seal check is done by PWVSB, not on your screen. \"Nothing recorded yet.\" means no entries exist."
  },
  {
    "view": "device",
    "title": "Site device",
    "what": "The shared phone or tablet kept at the guard post. Guards clock in and out by face, tap patrol checkpoints, report incidents, record visitors and write the post log here.",
    "who": "Only the site device sign-in. Each guard identifies with their staff number and face (patrols use a 4-digit PIN).",
    "tabs": [],
    "tasks": [
      {
        "task": "How to clock in or out",
        "steps": [
          "Press \"Clock in\" (or \"Clock out\").",
          "Type your \"Staff number\".",
          "Look at the camera.",
          "Press \"Scan face and clock in\" (or clock out), then \"Done\"."
        ]
      },
      {
        "task": "How to record a patrol checkpoint",
        "steps": [
          "Press \"Patrol checkpoint\".",
          "Type your \"Staff number\" and 4-digit PIN.",
          "Press \"Tap NFC tag\" and hold the back of the phone on the tag."
        ]
      },
      {
        "task": "How to report an incident",
        "steps": [
          "Press \"Report incident\".",
          "Type your staff number, fill in \"What happened\" and \"Details\".",
          "Add proof with \"Take photo\" or \"Attach document\".",
          "Press \"Report incident\"."
        ]
      },
      {
        "task": "How to send an SOS",
        "steps": [
          "Press \"SOS\".",
          "Press \"Send SOS\". Then phone your supervisor."
        ]
      },
      {
        "task": "How to ask for leave or give an absence reason",
        "steps": [
          "Press \"Leave or absence reason\".",
          "Type your staff number and look at the camera.",
          "Fill in the form and press \"Send request\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "NFC tag",
        "means": "A small coded sticker at each checkpoint the phone reads by touch."
      },
      {
        "term": "P1",
        "means": "The most urgent kind of case; an SOS opens one."
      }
    ],
    "notes": "Late, away from site or face not matched are recorded for the supervisor; a guard at the post is never refused. If the face engine is not connected, every record is marked for the supervisor to confirm. Patrols need an Android phone with NFC on. Without internet, entries wait under \"Waiting to send\"; press \"Send now\" later."
  },
  {
    "view": "doa",
    "title": "Director Office",
    "what": "The Director Office desk: every company's tenders and where each stands, quotations waiting for approval, this week's digest, CEO instructions, joint tenders, tenders and quotations found, the sites checked for tenders, and counters of tenders, quotations, reports and meetings.",
    "who": "Group leadership and the Director Office team. Tenders themselves are worked on each company's \"Tenders and quotations\" screen. Only the CEO can accept or return CEO instructions. \"Legal flags\" are for directors only.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to see tenders waiting for me",
        "steps": [
          "In \"Tenders\" press \"Waiting for you\".",
          "Or \"Being worked on\" or \"All\".",
          "Press a tender to open it on Tenders and quotations."
        ]
      },
      {
        "task": "How to give a CEO instruction",
        "steps": [
          "In \"CEO instructions\" under \"Give an instruction\" choose \"Who\".",
          "Fill in \"Instruction\", \"Done means\" and \"Due\".",
          "Press \"Give instruction\"."
        ]
      },
      {
        "task": "How to accept a finished instruction (CEO)",
        "steps": [
          "Find the one marked \"Done, waiting for the CEO\".",
          "Write a reason.",
          "Press \"Accept\" or \"Return to fix\"."
        ]
      },
      {
        "task": "How to enter more companies in one tender",
        "steps": [
          "In \"Joint tenders\" press \"Enter more companies\".",
          "Choose the \"Tender\" and tick the companies under \"Also entering\".",
          "Press \"Send to the companies\"."
        ]
      },
      {
        "task": "How to record a tender or quotation that was found",
        "steps": [
          "In \"Tenders and quotations found (peluang)\" press \"Record what was found\".",
          "Choose \"Kind\" and \"Government or private\", fill in \"Closes on\", \"Title\", \"Buyer or client\" and \"Where found\".",
          "Tick the companies to enter, or set them later with \"Set companies to enter\".",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to record a check of a tender site",
        "steps": [
          "In \"Sites to check for tenders\" find the site and press \"Record a check\".",
          "Choose \"What the check found\", fill in \"Result and gaps\", \"Tenders found\" and \"Follow-up\".",
          "Press \"Save check\"."
        ]
      },
      {
        "task": "How to see the counts for a month",
        "steps": [
          "In \"Reports and meetings counter\" choose the month.",
          "In \"Tender and quotation counter, every company\" choose the six months; press a company for detail."
        ]
      }
    ],
    "terms": [
      {
        "term": "Arahan petender",
        "means": "The tender instructions to bidders."
      },
      {
        "term": "T/B to confirm",
        "means": "Checklist items marked not applicable that still need confirming."
      },
      {
        "term": "Submission slip",
        "means": "The proof that the bid was submitted."
      },
      {
        "term": "Peluang",
        "means": "A tender or quotation opportunity that was found."
      }
    ],
    "notes": "A tender can only be sent as a joint tender after its checklist is made and checked. \"Checklists: test version sample draft\" under Tenders means the checklists are not read from the files yet. Prima does not visit or log in to the tender sites; staff record what they saw. \"Open Tenders and quotations\" only shows if you can open that screen. Press \"Show accepted\" to see finished instructions."
  },
  {
    "view": "reports",
    "title": "Reports",
    "what": "Weekly and monthly reports that each company and central department sends to the Director Office (page title \"Reports to the Director Office\"), and who has sent them.",
    "who": "Company managers, admin executives and group staff see the reports they must send. The Director Office sees \"Who has sent\" for everyone and can change the list.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to send a report",
        "steps": [
          "Under \"To send\" find the report.",
          "Press the period button (for example a month).",
          "Press \"Attach document\" and choose a PDF, JPEG or PNG.",
          "Tick the sections it covers if asked, add a \"Note (optional)\".",
          "Press \"Send report\"."
        ]
      },
      {
        "task": "How to see who has not sent (Director Office)",
        "steps": [
          "Go to \"Who has sent\".",
          "Press \"Not sent\" or \"Late\".",
          "Press a report to see each sender."
        ]
      },
      {
        "task": "How to change the report list (Director Office)",
        "steps": [
          "Press \"Change the report list\".",
          "Edit a report, press \"Add a report\" or \"Take off the list\".",
          "Fill in \"What changed and why\".",
          "Press \"Save the list\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Not due yet",
        "means": "The due date has not come."
      },
      {
        "term": "Unknown, not on the app",
        "means": "That company is not on Prima yet, so it is not known."
      }
    ],
    "notes": "\"Send report\" stays grey until a document is attached. A period already sent cannot be pressed again. \"No report is due from you.\" means nothing is on your list. The starting list is a proposal the Director Office can change."
  },
  {
    "view": "surveys",
    "title": "Site survey",
    "what": "Fill in a site survey on your phone at the site, even with no signal. Photos and measurements stay on the phone and are sent by themselves when there is a signal.",
    "who": "Sales, company managers, admin executives, operations and site officers (supervisors only for their own sites). The Project Director (COO, Operations General Manager, Operations Director) accepts or returns surveys.",
    "tabs": [
      {
        "name": "On this phone",
        "what": "Surveys kept on this phone: not finished, waiting for signal or sent."
      },
      {
        "name": "Sent surveys",
        "what": "Surveys the office has received."
      },
      {
        "name": "To decide",
        "what": "Surveys waiting for your accept or return."
      }
    ],
    "tasks": [
      {
        "task": "How to do a new survey",
        "steps": [
          "Press \"New site survey\".",
          "Choose the company and whether it is \"A sales lead\", \"Our existing site\" or \"A new place\".",
          "Press \"Record location (GPS)\".",
          "Fill in the details, \"Add a measurement\", the risks, and \"Add a post\" for each guard post.",
          "Press \"Take a photo\", write the findings, then press \"Finish and send\"."
        ]
      },
      {
        "task": "How to stop and continue later",
        "steps": [
          "Press \"Save and close\".",
          "Later, open \"On this phone\" and press \"Continue\"."
        ]
      },
      {
        "task": "How to send when signal comes back",
        "steps": [
          "The phone sends by itself.",
          "To try at once, press \"Send now\".",
          "If a survey was refused, press \"Fix and send\"."
        ]
      },
      {
        "task": "How to accept or return a survey (Project Director)",
        "steps": [
          "Open \"To decide\" and press the survey.",
          "Write \"Your reason\".",
          "Press \"Accept survey\" or \"Return to surveyor\"."
        ]
      },
      {
        "task": "How to redo a returned survey",
        "steps": [
          "Open it under \"Sent surveys\".",
          "Press \"Redo this survey (answers copied, take new photos)\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Waiting for signal",
        "means": "The survey is finished and will be sent when the phone has signal."
      }
    ],
    "notes": "\"You have no company to survey for. Ask your manager.\" means you are not set up for any company. If the browser cannot keep data, keep the app open until the survey is sent. If the office database is not ready, the message is \"Site survey storage is not switched on yet. Your survey stays on the phone and is sent later.\" Deleting a survey from the phone cannot be undone."
  },
  {
    "view": "meetings",
    "title": "Meetings",
    "what": "Meetings across the group: invitations and answers, agenda, pre-brief checklist, attendance, minutes, summaries and action items, the regular meetings your job needs, and a calendar of every date that matters in the next 60 days.",
    "who": "Directors and group staff, company managers and admin executives. \"New meeting\" only shows to people who may schedule. Ticking the pre-brief, adding minutes and adding action items show only to people who run that meeting; an action item's owner can mark it done. The Director Office checks summaries. \"Monthly operations\" shows only to those it is for.",
    "tabs": [
      {
        "name": "Meetings and minutes",
        "what": "Upcoming and past meetings; press one for its details."
      },
      {
        "name": "Regular meetings",
        "what": "The meetings your job needs and whether this period's one is set, held or late."
      },
      {
        "name": "My action items",
        "what": "Open action items given to you, with overdue ones marked."
      },
      {
        "name": "Monthly operations",
        "what": "The COO's monthly operations meeting with each operations section, and each company's own."
      },
      {
        "name": "Calendar",
        "what": "Meetings, action items, tender closing dates and reports due in the next 60 days."
      }
    ],
    "tasks": [
      {
        "task": "How to set a meeting",
        "steps": [
          "Press \"New meeting\".",
          "Fill in \"Title\", \"Kind\", \"Date\", \"From\", \"To\", \"Repeats\" and \"Where\".",
          "Search and tick staff under \"Invite staff\"; add others in \"Guests without a Prima account\".",
          "Write the agenda, one item per line.",
          "Press \"Save meeting\". Invited staff see it on their home screen."
        ]
      },
      {
        "task": "How to set a regular meeting",
        "steps": [
          "Open \"Regular meetings\" (\"Only not done\" hides the ones held).",
          "Press \"Set it\": title, invitations and agenda are filled in.",
          "Check the date and time, then press \"Save meeting\"."
        ]
      },
      {
        "task": "How to answer an invitation",
        "steps": [
          "Open the meeting marked \"Answer the invitation\".",
          "Press \"Attending\", \"Not sure yet\" or \"Not attending\".",
          "For \"Not attending\" write why you cannot attend and press \"Send\"."
        ]
      },
      {
        "task": "How to change or cancel a meeting",
        "steps": [
          "Open the meeting.",
          "Press \"Change date, place, agenda or invitees\", make the change, fill in \"Reason for the change\" and press \"Save the change\".",
          "Or press \"Cancel the meeting\", write why, and press \"Cancel it\"."
        ]
      },
      {
        "task": "How to add minutes after a meeting",
        "steps": [
          "Open the meeting and find \"Add the minutes\".",
          "Under \"Who was there\" mark each person \"Present\", \"Apology\" or \"Absent\"; add \"Guests present\".",
          "Paste the text in \"Minutes\" (start action items with \"Action:\").",
          "Press \"Save minutes\". To fix them later use \"Correct the minutes\"."
        ]
      },
      {
        "task": "How to mark an action item done",
        "steps": [
          "Open the meeting (or press the item in \"My action items\").",
          "Under \"Action items\" write \"What was done (optional)\" and press \"Done\" (or \"Reopen\").",
          "For a missing one press \"Add an action item\", fill in what, who and when, press \"Add action item\"."
        ]
      },
      {
        "task": "How to check a summary (Director Office)",
        "steps": [
          "Open a meeting marked \"Summary to check\".",
          "Press \"Summary is right\", or \"Correct the action items\", fix them and press \"Save and mark checked\"."
        ]
      },
      {
        "task": "How to put dates in Outlook",
        "steps": [
          "Open \"Calendar\".",
          "Press \"Add all to Outlook\", or \"Outlook\" on one line.",
          "Open the file that downloads."
        ]
      }
    ],
    "terms": [
      {
        "term": "Pre-brief",
        "means": "The preparation checklist to finish before the meeting."
      },
      {
        "term": "Action item",
        "means": "A job agreed in the meeting, with an owner and a date."
      }
    ],
    "notes": "Outlook gets a calendar file with a reminder the day before; Prima does not send Outlook invitations or emails yet, so invited staff see meetings and reminders in Prima. Minutes can only be added after the meeting. The summary is drafted automatically from the minutes and the Director Office checks it. Cancelling a meeting or saying you cannot attend needs a reason."
  },
  {
    "view": "mine",
    "title": "Duty",
    "what": "Your own record: your shifts for the next 14 days, your clock-in history, patrol rounds, and your papers, training, hours, leave and warnings.",
    "who": "Guards and supervisors see it as \"Duty\". Office staff see it as \"My details\" and it opens straight on their details. Only you see your own record. Shown only if you have a staff record.",
    "tabs": [
      {
        "name": "Roster",
        "what": "Your published shifts for the next 14 days."
      },
      {
        "name": "Clock in and out",
        "what": "Your clock-ins and clock-outs for the last 30 days."
      },
      {
        "name": "Patrols",
        "what": "Your patrol rounds for the last 7 days, done or missed."
      },
      {
        "name": "My details",
        "what": "Sub-tabs \"Papers\", \"Training\", \"Hours and pay\", \"Leave\", \"SOCSO\", \"Warnings\", \"Benefits\"."
      }
    ],
    "tasks": [
      {
        "task": "How to see my next shift",
        "steps": [
          "Look at the box at the top: \"On duty now\" or \"Next shift\".",
          "Or open \"Roster\" for the full list."
        ]
      },
      {
        "task": "How to check if I was marked late",
        "steps": [
          "Open \"Clock in and out\".",
          "Each day shows \"On time\", \"Late\" or \"Not attended\"."
        ]
      },
      {
        "task": "How to confirm an item given to me",
        "steps": [
          "Find \"Items issued to me\".",
          "Press \"I received it\".",
          "If not right, press \"Something is wrong\", write what, then \"Send to the store\"."
        ]
      },
      {
        "task": "How to see my leave balance",
        "steps": [
          "Open \"My details\", then \"Leave\".",
          "Read \"Annual leave left\" and \"Sick days left\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Done by colleague",
        "means": "Another guard did that patrol round."
      },
      {
        "term": "SOCSO",
        "means": "The government social security scheme for workers."
      }
    ],
    "notes": "For guards this screen is view only: to ask for leave or give an absence reason, use the site device or tell your Operations Manager (OM). \"My payslips\" says \"No payslips here yet\" while pay still comes from the JA Group app. Items panels only show when something was issued to you."
  },
  {
    "view": "clock",
    "title": "Clock",
    "what": "Your own office clock (page title \"My clock\"). You are clocked in when you sign in to Prima and clocked out when you sign out. You can also check in by place, register your face and apply to work from home.",
    "who": "Office staff, managers and group staff who have their own staff record. Guards do not use it: they clock in by face on the site device.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to check in when I arrive",
        "steps": [
          "In the \"Check in\" box press \"Check in\".",
          "Press \"Enable location\" and choose Allow.",
          "Press \"Continue\" (give a reason if you are outside your area).",
          "Do the face check if asked.",
          "Press \"Check in now\", then \"Done\"."
        ]
      },
      {
        "task": "How to check out",
        "steps": [
          "Press \"Check out\" in the same box.",
          "Follow the same steps and press \"Check out now\"."
        ]
      },
      {
        "task": "How to see where I went today",
        "steps": [
          "Look at \"My movement today\": how far you moved, time inside and outside your place, and the route on the map.",
          "Press a day in \"Last 7 days\" to see that day."
        ]
      },
      {
        "task": "How to register my face",
        "steps": [
          "In \"Face recognition\" press \"Register my face\".",
          "Take the photo. HR approves it.",
          "Later, if asked, press \"Check my face\"."
        ]
      },
      {
        "task": "How to apply to work from home",
        "steps": [
          "In \"Working from home\" press \"Apply to work from home\".",
          "Pick the days, \"From\" and \"Until\", and give your reason.",
          "Your manager answers in writing."
        ]
      }
    ],
    "terms": [
      {
        "term": "Location unknown",
        "means": "No location reading for a while; your manager sees Unknown."
      },
      {
        "term": "Outstation",
        "means": "A day you are allowed to check in anywhere."
      },
      {
        "term": "Out of area",
        "means": "You checked in outside your allowed place."
      },
      {
        "term": "Out of station",
        "means": "Outside your place for more than 15 minutes while clocked in; your manager sees it."
      }
    ],
    "notes": "Location is recorded only while you are clocked in. If the browser blocked location, follow the help shown and press \"Try again\". If your company is set to refuse check-ins outside the area, you can only \"Record this attempt for my manager\". \"Working from home\" only shows once you are eligible. The owner has no staff clock: the owner sees \"Check in (test)\" and \"Check out (test)\" with the route on a map and \"My test check-ins\"; a test is never attendance or pay."
  },
  {
    "view": "staffclock",
    "title": "Staff clock",
    "what": "Who of the office staff is clocked in today, where, late arrivals, long breaks, who left the office while still signed in, and time slips (going out for own matters and working the hours back).",
    "who": "Directors and group leaders, company managers and HR. The IT Manager sees the IT team only, view only. \"Check-in places\" and \"Out of area\" show only to HR, managers and leaders who set check-in places.",
    "tabs": [
      {
        "name": "Clock today",
        "what": "Everyone's clock today with problems flagged."
      },
      {
        "name": "Working from home",
        "what": "Home-working applications and home days to review."
      },
      {
        "name": "Time slips",
        "what": "Time slips waiting for approval, hours still to work back, and hours taken from leave."
      },
      {
        "name": "Check-in places",
        "what": "Offices and places where staff may check in."
      },
      {
        "name": "Out of area",
        "what": "Check-ins made outside the allowed place, to review."
      }
    ],
    "tasks": [
      {
        "task": "How to find staff with a problem",
        "steps": [
          "Open \"Clock today\".",
          "Press \"Needs a look\".",
          "Or search in \"Search name, title or company\".",
          "Press a person to see their clock record."
        ]
      },
      {
        "task": "How to see who went out of station",
        "steps": [
          "Open \"Clock today\" and look at \"Movement to look at\" (or press \"Out of station\").",
          "Press a line to see the route, the timeline and how long they were outside."
        ]
      },
      {
        "task": "How to review an out-of-area check-in",
        "steps": [
          "Open \"Out of area\" and press the line.",
          "Write a \"Comment (needed)\".",
          "Press \"Accept the reason\" or \"Follow up\"."
        ]
      },
      {
        "task": "How to add a check-in place",
        "steps": [
          "Open \"Check-in places\".",
          "Press \"Add place\".",
          "Search the address or tap the map to drop the pin (or \"Use where I am\"), set \"Allowed radius\" and \"Name\".",
          "Press \"Save place\".",
          "Above, choose \"Allow with a reason\" or \"Refuse\" for check-ins outside the area."
        ]
      },
      {
        "task": "How to approve a registered face (HR)",
        "steps": [
          "Find \"Faces waiting for HR\".",
          "Check the photo, write a comment.",
          "Press \"Approve\" or \"Refuse\"."
        ]
      },
      {
        "task": "How to approve a time slip",
        "steps": [
          "Open \"Time slips\" and find \"Waiting for you to approve\".",
          "Write a comment (a comment is needed to approve or refuse).",
          "Press \"Approve\" or \"Refuse\". HR is told of every approval."
        ]
      },
      {
        "task": "How to see who still owes hours (HR)",
        "steps": [
          "Open \"Time slips\".",
          "Press \"Still to work back\", \"Taken from leave\" or \"New for HR\".",
          "Press \"Mark seen\" on a slip you have checked."
        ]
      }
    ],
    "terms": [
      {
        "term": "Away from base",
        "means": "The last location reading was outside the staff member's base."
      },
      {
        "term": "Left the office, still signed in",
        "means": "The office door shows they went out but did not sign out."
      },
      {
        "term": "Time slip",
        "means": "Permission to go out during office hours for own matters; the hours are worked back after office hours, or taken from annual leave."
      }
    ],
    "notes": "No reading for a while shows as Unknown, never as fine. If there are no office door readings for the day, the door check is Unknown. Nobody approves their own face or reviews their own check-in."
  },
  {
    "view": "work",
    "title": "Work",
    "what": "Your daily tasks and what \"done\" means for each, a morning check-in, and help when you are stuck. Managers also see their team's work and review it.",
    "who": "Office staff, managers and group leadership. You see \"My work\" if you have your own staff record, \"My team\" and \"Rebalance\" if people report to you, and \"Monday summary\" if you are group leadership.",
    "tabs": [
      {
        "name": "My team",
        "what": "Your people, overdue tasks, help requests and tasks to review."
      },
      {
        "name": "My work",
        "what": "Your own check-in, tasks, results and playbook."
      },
      {
        "name": "Rebalance",
        "what": "Suggested moves when someone is overloaded, on leave or overdue."
      },
      {
        "name": "Monday summary",
        "what": "Last week by department and far branch, for group leadership."
      }
    ],
    "tasks": [
      {
        "task": "How to send my morning check-in",
        "steps": [
          "Open \"My work\".",
          "Choose where you work today, check \"Hours today\".",
          "Fill in \"Priority 1\" to \"Priority 3\".",
          "Press \"Send check-in\"."
        ]
      },
      {
        "task": "How to finish a task",
        "steps": [
          "Find it under \"To do\".",
          "Press \"Finish with proof\".",
          "Fill in \"Proof\" and \"Reference\".",
          "Press \"Send\". It goes to your manager for review."
        ]
      },
      {
        "task": "How to ask for help or more time",
        "steps": [
          "On the task press \"Stuck? Ask for help\" or \"Ask for more time\".",
          "Write what you need.",
          "Press \"Send\"."
        ]
      },
      {
        "task": "How to review a team member's task (manager)",
        "steps": [
          "Open \"My team\" and press the person.",
          "On a waiting task write a comment (a comment is needed to accept or return it).",
          "Press \"Accept\" or \"Return to fix\"."
        ]
      },
      {
        "task": "How to give a task",
        "steps": [
          "Group leaders press \"Give a task\" at the top; managers open a person in \"My team\".",
          "Fill in \"Task\", \"Done means\" and \"Due\".",
          "Press \"Give task\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Done means",
        "means": "What the finished work must look like so it can be checked."
      },
      {
        "term": "Playbook",
        "means": "The regular tasks for your job."
      },
      {
        "term": "Talk to",
        "means": "A reminder to the manager to have a word, not a finding."
      }
    ],
    "notes": "Tasks are also kept in Microsoft Planner (may still be a test connection). Help not answered in 30 minutes also goes to the manager's manager. \"No work screen for this sign-in\" means no staff record and no team."
  },
  {
    "view": "branchwork",
    "title": "Far branches",
    "what": "Checks for branches far from head office: daily, weekly and monthly checklists with a photo, OM and Regional OM visits, ACT audits and video spot checks, scored on 8 measures.",
    "who": "The branch manager, the company manager, OM and above, ACT and CMS, and group leadership. Admin executives only see it if they run a branch.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to send the daily checklist (branch manager)",
        "steps": [
          "Press your branch in the \"Branches\" list.",
          "Under \"Checklists\" tick each item that is fine; untick and write a note if not.",
          "Press \"Take the photo\".",
          "Press \"Send daily checklist\"."
        ]
      },
      {
        "task": "How to record a visit or spot check",
        "steps": [
          "Open the branch.",
          "Under \"Visits and spot checks\" press the \"Record ...\" button for your kind of visit.",
          "Write the \"Findings\"; tick \"Issues found\" if any.",
          "Take the photo (not needed for a video spot check).",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to read a branch's scorecard",
        "steps": [
          "Open the branch.",
          "Read \"Scorecard\": each measure is Green, Amber, Red or Unknown."
        ]
      }
    ],
    "terms": [
      {
        "term": "Unknown",
        "means": "No data for that measure. It is never shown as green."
      },
      {
        "term": "Video spot check",
        "means": "A surprise check by video, up to 2 a month per branch."
      },
      {
        "term": "ACT unannounced audit",
        "means": "A surprise audit visit by the ACT team."
      }
    ],
    "notes": "The checklist form only shows to people allowed to send it, and only until it is sent. The send button stays grey until the photo is taken. Visit and spot-check limits are proposals waiting for approval. \"No branches for this sign-in\" means none are linked to you."
  },
  {
    "view": "fwm",
    "title": "Foreign workers",
    "what": "Foreign Worker Management keeps every foreign worker's permit, passport, FOMEMA and insurance renewed, sends OMs dated tasks, and tracks recruitment and welfare. The JA Group app's dates show beside Prima's.",
    "who": "FWM staff work it. FWM staff and the owner add workers and old paper dates. Leaders a paper has reached acknowledge it. OMs see only \"Tasks\". Company managers see their company's steps; fees, notes and what workers raise stay with FWM and group leaders.",
    "tabs": [
      {
        "name": "Papers",
        "what": "Papers on the reminder ladder, with days left and who still has to acknowledge."
      },
      {
        "name": "Workers",
        "what": "FWM finds a worker and records each paper from its copy. Each worker shows whether their own phone sign-in is set up."
      },
      {
        "name": "Prima and JA",
        "what": "Where Prima and the JA app disagree on dates, workers or status."
      },
      {
        "name": "Year 10",
        "what": "Workers reaching their service limit within a year."
      },
      {
        "name": "Tasks",
        "what": "Tasks sent to the OMs and their proof."
      },
      {
        "name": "Recruitment and welfare",
        "what": "Arrival fee checks, passport checks, welfare talks and follow-ups."
      },
      {
        "name": "Recruitment steps",
        "what": "Each new recruit's steps before travel and arrival."
      }
    ],
    "tasks": [
      {
        "task": "How to add a foreign worker",
        "steps": [
          "Press \"Add\" at the top, choose \"Foreign worker\", fill the form, press \"Save\".",
          "For the old list, press \"Import from file\" at the top and choose \"Foreign worker\"."
        ]
      },
      {
        "task": "How to load old paper dates",
        "steps": [
          "Press \"Import from file\" at the top and choose \"Paper dates from the old system\": one row per paper, with the staff number, the paper and its expiry.",
          "A date is added only where Prima has none, and shows \"Typed in\" until the paper is recorded from its copy."
        ]
      },
      {
        "task": "How to acknowledge a paper alert",
        "steps": [
          "On \"Papers\", choose \"Acknowledgement owed\" under \"Show only\".",
          "Press \"Acknowledge\", add a note if you like, press \"Acknowledge\" again."
        ]
      },
      {
        "task": "How to record a new paper",
        "steps": [
          "Press \"New paper received\", fill the number, \"Issued on\" and \"Expires on\", attach the copy, press \"Save\".",
          "To fix a wrong entry, open \"Workers\", press \"Papers\", then \"Correct a mistake\" and fill \"What was wrong\"."
        ]
      },
      {
        "task": "How to record a renewal",
        "steps": [
          "Press \"Renewal submitted\", fill \"Submitted on\", \"Where\", \"Note\", attach the document, press \"Save\"."
        ]
      },
      {
        "task": "How to settle a Prima and JA difference",
        "steps": [
          "Open \"Prima and JA\". Press \"Use the JA date\" if JA is right, or record the paper from its copy.",
          "For a worker only in JA, press \"Add to Prima\", fill \"Branch\", \"Hire date\" and \"Date of birth (passport)\", press \"Add\"."
        ]
      },
      {
        "task": "How to send and finish an OM task",
        "steps": [
          "FWM presses \"Send task to OM\", fills \"Task\", \"Due\", \"What the OM must do\" and \"Place\", presses \"Send\".",
          "The OM presses \"Done, send proof\", attaches proof, presses \"Send\". FWM presses \"Accept\" or \"Send back\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "PLKS",
        "means": "The foreign worker's work permit."
      },
      {
        "term": "FOMEMA",
        "means": "The required medical check for foreign workers."
      },
      {
        "term": "Reminder ladder",
        "means": "Reminders at 120, 90, 60, 30 and 15 days before expiry, going up to the Chief of Staff, COO and CEO."
      }
    ],
    "notes": "Acknowledge an alert within 1 working day. A submitted renewal pauses the reminders. \"No expiry on record\" means unknown, not safe. When Prima and JA differ, the ladder counts to the earlier date until FWM settles it. FWM also has \"Look up staff history\" at the bottom. Foreign workers are guards in Prima: HR or the company office enrols their own phone (\"Enrol phone\"); clocking in stays on the site device. If you cannot add, the screen says who does. The welfare \"Closed\" and \"Agencies\" tabs show only to FWM and group leaders."
  },
  {
    "view": "socso",
    "title": "SOCSO claims",
    "what": "Start and follow SOCSO (PERKESO) claims for staff hurt at work or in other covered cases: papers, deadlines, return to work, LINDUNG, family payments after a death and the DOSH notice.",
    "who": "HR and the OM start claims. HR submits Form 34 in PERKESO ASSIST and moves the claim along. Medical papers are seen by HR only. HR and operations staff follow claims for their companies.",
    "tabs": [
      {
        "name": "Claim",
        "what": "Inside a claim: what happened, papers, PERKESO's decision and history."
      },
      {
        "name": "Rehabilitation",
        "what": "Return to work, restrictions, appointments and weekly check-ins."
      },
      {
        "name": "LINDUNG",
        "what": "Accident outside work: the worker's application and PERKESO's employment check."
      },
      {
        "name": "Family and payments",
        "what": "After a death: dependants, missing papers and PERKESO payments."
      },
      {
        "name": "DOSH",
        "what": "The separate notice to DOSH for a serious workplace accident."
      }
    ],
    "tasks": [
      {
        "task": "How to start a claim",
        "steps": [
          "Press \"Start a claim\" and find the person (or \"Start SOCSO claim\" on their profile).",
          "Choose \"Kind of case\" (or \"Not sure which kind?\"), fill what happened, when and where, press \"Start claim\"."
        ]
      },
      {
        "task": "How to record Form 34",
        "steps": [
          "Under \"Next step\" press \"Form 34 submitted in ASSIST\", type the \"PERKESO reference from ASSIST\", press \"Save\"."
        ]
      },
      {
        "task": "How to add papers",
        "steps": [
          "Under \"Papers\", press \"Add paper\", attach it, press \"Save\". If a paper cannot be had, press \"Go ahead without\" with the reason."
        ]
      },
      {
        "task": "How to handle LINDUNG",
        "steps": [
          "Fill \"How the worker applied\" and \"Date applied\", press \"Save application\".",
          "When PERKESO emails, press \"PERKESO's email came\", then \"Record the answer given to PERKESO\"."
        ]
      },
      {
        "task": "How to record family payments",
        "steps": [
          "Press \"Add dependant\", then \"Record how PERKESO pays\", \"Record a PERKESO payment\" and \"Family confirmed receipt\"."
        ]
      },
      {
        "task": "How to record the DOSH notice",
        "steps": [
          "Choose the level, type the reason, press \"Save the level\". Fill \"Told DOSH at once\", the form and \"Client told\", pressing \"Save\" each time."
        ]
      }
    ],
    "terms": [
      {
        "term": "PERKESO",
        "means": "The SOCSO agency."
      },
      {
        "term": "Form 34",
        "means": "The accident notice to PERKESO, made online in ASSIST."
      },
      {
        "term": "LINDUNG 24 Jam",
        "means": "SOCSO cover for accidents outside work; PERKESO pays the worker directly."
      },
      {
        "term": "DOSH (JKKP)",
        "means": "The safety at work department."
      }
    ],
    "notes": "Form 34 is due 48 hours after the company was told; a reminder shows at 24 hours. For LINDUNG the worker applies, not the company. Prima sends nothing to PERKESO or DOSH; HR does it and keeps copies. A rejected claim can be appealed within 90 days. The roster will not place someone against an open restriction. Read \"How to claim (SOP)\" for what SOCSO pays for."
  },
  {
    "view": "fwcost",
    "title": "Recruitment cost",
    "what": "When a foreign worker works under another company's or a branch's job, the host pays FWM a monthly recruitment cost per worker and FWM pays the owning company back. This page tracks placements, monthly charges and payments.",
    "who": "FWM staff record placements and see only placements. Finance teams draft months and record invoices and payments. The Finance Director or CEO set rates and approve. Group leaders see everything. A company manager sees their own company's charges.",
    "tabs": [
      {
        "name": "Charges",
        "what": "Monthly charges with approval, invoice and payment."
      },
      {
        "name": "Placements",
        "what": "Workers working under another company or branch."
      },
      {
        "name": "Rates",
        "what": "Charge to host and payback to owner."
      },
      {
        "name": "CEO log",
        "what": "The CEO's legal note. Only the CEO sees it."
      }
    ],
    "tasks": [
      {
        "task": "How to record a placement (FWM)",
        "steps": [
          "Open \"Placements\" and press \"Record a placement\".",
          "Choose the worker, company, branch and \"Who pays the salary\", set \"First day under that job\", and press \"Save\".",
          "When it ends press \"End the placement\", give the last day and why, and press \"End\"."
        ]
      },
      {
        "task": "How to draft a month's charges (Finance)",
        "steps": [
          "Open \"Charges\".",
          "Under \"Months to draft\" press the \"Draft\" button for that month."
        ]
      },
      {
        "task": "How to approve or reject a month (FD or CEO)",
        "steps": [
          "Press \"Approve\" for the month, or \"Reject\".",
          "Write the reason.",
          "Press \"Approve\" or \"Reject\" again to confirm."
        ]
      },
      {
        "task": "How to record the invoice and payment (Finance)",
        "steps": [
          "Raise the invoice in SQL Account first.",
          "Press \"Record the invoice\", type its number and date, and press \"Save\".",
          "After the bank transfer, press \"Record the payment\", add the reference and slip, and press \"Save\"."
        ]
      },
      {
        "task": "How to set a rate (FD or CEO)",
        "steps": [
          "Open \"Rates\" and choose which rate.",
          "Type the RM per worker per month, the from month and the reason.",
          "Press \"Save rate\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Billed, not paid",
        "means": "An invoice is recorded but no payment yet."
      }
    ],
    "notes": "A month cannot be drafted until both rates are set; the app never guesses a rate. The person who drafted cannot approve; another approver (FD or CEO) decides. Tabs you do not see are not for your role."
  },
  {
    "view": "fwstat",
    "title": "Nepali EPF/SOCSO",
    "what": "The company holding a Nepali worker's permit pays EPF and SOCSO. The company or branch that used the worker repays that amount each month, by debit note, for the days it used the worker.",
    "who": "FWM, Finance teams, group leaders, company managers and admin executives. A Branch Manager sees and repays only their own branch. The owner company's Finance prepares debit notes, cancels them and checks money in.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to prepare a debit note (owner's Finance)",
        "steps": [
          "In \"Months to charge\" press \"Prepare the debit note\".",
          "For each worker fill \"Wage for the month (RM)\", the EPF and SOCSO amounts paid, and the KWSP and PERKESO receipt numbers.",
          "Press \"Issue the debit note\"."
        ]
      },
      {
        "task": "How to record a repayment",
        "steps": [
          "Find the debit note under \"Debit notes\".",
          "Press \"Record the repayment\".",
          "Repay the full amount in one transfer, then type the bank transfer reference and date.",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to check in the money (owner's Finance)",
        "steps": [
          "Press \"Check in the money\" on a repaid note.",
          "Type the bank statement line or comment.",
          "Press \"Checked in\"."
        ]
      },
      {
        "task": "How to cancel a debit note",
        "steps": [
          "Press \"Cancel\" on an issued note.",
          "Write why it is cancelled.",
          "Press \"Cancel the debit note\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Debit note",
        "means": "The bill from the permit company to the company or branch that used the worker."
      },
      {
        "term": "Late",
        "means": "Not repaid within the set number of days."
      }
    ],
    "notes": "\"Months to charge\" and \"To check in\" show only to the owner company's Finance. The person who recorded the repayment cannot check it in; another person in the owner's Finance does. The salary is paid by the company or branch that uses the worker, not by this page."
  },
  {
    "view": "hostels",
    "title": "Hostels",
    "what": "Hostel bills (rent, electricity, water, maintenance) and their approval to pay, plus each worker's share of utility use above the allowance.",
    "who": "The company that owns or rents the hostel adds bills and asks for approval. FWM checks, the Operations Director (private) or OGM (government) approves, then the COO. The company pays and uploads the slip. HR decides on utility excess.",
    "tabs": [
      {
        "name": "Bills",
        "what": "Each hostel with its beds, monthly payment history and bills."
      },
      {
        "name": "Utility excess",
        "what": "Each worker's share of electricity or water above the allowance, for HR to decide."
      }
    ],
    "tasks": [
      {
        "task": "How to add a hostel",
        "steps": [
          "Press \"Add hostel\" at the top (or \"Import\" for a list)."
        ]
      },
      {
        "task": "How to add a bill",
        "steps": [
          "On the hostel, press \"Add a bill\".",
          "Choose \"Kind\", fill \"Month billed\", \"Amount (RM)\" and \"Due date\".",
          "Press \"Attach document\" for the bill, then \"Save the bill\"."
        ]
      },
      {
        "task": "How to move a bill along",
        "steps": [
          "Press \"Act\" on the bill.",
          "The company presses \"Ask for payment approval\".",
          "To check or approve, type a comment (a comment is needed to approve), then press \"Checked, pass on\" or \"Approve\". To return it, type a comment and press \"Send back\".",
          "After paying, attach the slip and press \"Upload the payment slip\"."
        ]
      },
      {
        "task": "How to decide utility excess (HR)",
        "steps": [
          "Open \"Utility excess\" and press \"HR to decide\".",
          "Press \"Give a notice\" or \"Deduct from pay\".",
          "When the worker signs, press \"Worker signed the notice\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Bed-days",
        "means": "Nights each worker stayed; the extra cost is shared by these."
      },
      {
        "term": "Utility clause",
        "means": "A contract clause allowing a utility deduction."
      }
    ],
    "notes": "The allowance is RM30 electricity and RM20 water a head a month. The 1st and 2nd excess are notices only; from the 3rd HR may deduct, only if the contract has the utility clause (\"Deduct from pay\" is greyed out otherwise, and FWM gets a task to add it). The count never resets. No slip is needed when Finance recorded the payment. Overdue bills climb to the Chief of Staff, COO and CEO. \"Utility excess\" shows only when there are charges."
  },
  {
    "view": "claims",
    "title": "Claims",
    "what": "Claim back your own medical, dental, optical, yearly check-up and travel costs. Approvers decide other staff claims here.",
    "who": "Office and management staff claim for themselves (not guards or patrolling officers). HR checks every claim, the company head may verify it, the Chief of Staff approves trips and sets mileage rates, the COO approves, and Finance records payment. You see only the tabs and buttons for your part.",
    "tabs": [
      {
        "name": "My claims",
        "what": "Your claims, \"My receipts\" and \"Trips to approve before you go\"."
      },
      {
        "name": "All claims",
        "what": "Claims and trips waiting for your decision. Its name depends on your role: \"For the Chief of Staff\", \"For the COO\", \"All claims\" or \"To verify as company head\"."
      },
      {
        "name": "Enter for staff",
        "what": "HR enters a claim or trip for a staff member."
      },
      {
        "name": "Mileage rates",
        "what": "The rate per km for each vehicle, by month."
      }
    ],
    "tasks": [
      {
        "task": "How to keep a receipt and claim it",
        "steps": [
          "In \"My receipts\", press \"Scan with camera\" or \"Upload file\".",
          "Check \"Date\", \"Total (RM)\", \"Shop or clinic\" and \"What it is for\", then press \"These are right\".",
          "Press \"Claim now\", then \"Send the claim\"."
        ]
      },
      {
        "task": "How to make a medical, dental or optical claim",
        "steps": [
          "Press \"New claim\" and choose \"Kind of claim\".",
          "Fill \"Receipt date\" and \"Receipt amount (RM)\", press \"Attach document\" for the receipt.",
          "Press \"Send the claim\"."
        ]
      },
      {
        "task": "How to claim travel",
        "steps": [
          "Before the trip, fill \"Trip date\", \"Where to\" and \"Why\" and press \"Ask to travel\".",
          "After it, press \"New claim\", choose \"Travel\" and pick the \"Approved trip\".",
          "Fill \"Vehicle\", \"Km, office there and back\" and any toll, parking, nights and hotel, attach those receipts, press \"Send the claim\"."
        ]
      },
      {
        "task": "How to decide on a claim or trip",
        "steps": [
          "Open your decision tab and press \"Waiting for me\".",
          "Type a comment. A comment is needed to approve, verify or reject.",
          "Press \"Approve\", \"Checked, to COO\" (HR), \"Verify\" (company head) or \"Reject\". Finance types the \"Payment reference\" and presses \"Record payment\"."
        ]
      },
      {
        "task": "How to publish mileage rates (Chief of Staff)",
        "steps": [
          "Open \"Mileage rates\", choose \"Vehicle\", type \"RM per km\".",
          "Press \"Publish for\" the month."
        ]
      }
    ],
    "terms": [
      {
        "term": "Mileage rate",
        "means": "The amount paid per km, set monthly by the Chief of Staff for each vehicle."
      }
    ],
    "notes": "Limits on screen: medical and dental RM1,000 a year, optical RM500 every 2 years. Travel cannot be claimed until that month's mileage rates are published. Claim within the days shown; the same receipt or trip cannot be claimed twice, and \"Claim now\" greys out when too late. No valet parking. Travel with no approved trip, or km more than 10% off the app's km, goes to the Chief of Staff first. \"Nothing to claim here\" means claims are for office and management staff only."
  },
  {
    "view": "pdpa",
    "title": "PDPA",
    "what": "Personal data matters: breaches with a 72-hour clock, client consent, social media, the register of personal data kept, signed consents, product checks, people's data requests and data protection officers.",
    "who": "The PDPA officer handles every case. The Operations Director, the Chief of Staff and the CEO monitor. The Chief of Staff switches PDPA on or off.",
    "tabs": [
      {
        "name": "Breaches",
        "what": "Breaches, with the Commissioner deadline counting down."
      },
      {
        "name": "Client consent",
        "what": "Getting a client's consent before a product is used."
      },
      {
        "name": "Social media",
        "what": "Social media matters by risk."
      },
      {
        "name": "Data register",
        "what": "Every kind of personal data kept, why and for how long."
      },
      {
        "name": "Consents",
        "what": "Each person's signed consent and withdrawals."
      },
      {
        "name": "Breach register",
        "what": "Every breach, kept after closing."
      },
      {
        "name": "Products",
        "what": "Products for clients and their certificates."
      },
      {
        "name": "Proposal check",
        "what": "Check a proposal's products are ready."
      },
      {
        "name": "Data requests",
        "what": "Requests from people about their own data."
      },
      {
        "name": "DPO register",
        "what": "The data protection officer for each company."
      },
      {
        "name": "Settings",
        "what": "PDPA on or off, and how long the breach register is kept."
      }
    ],
    "tasks": [
      {
        "task": "How to open a case",
        "steps": [
          "Choose the tab, press \"Open a case\", choose \"Company\", fill \"Title\" and \"What happened\", press \"Open case\"."
        ]
      },
      {
        "task": "How to record the next step",
        "steps": [
          "Press \"Act\" on the case, attach proof when needed and add a \"Note\".",
          "Press the step, such as \"Contained\", \"Commissioner notified\", \"People notified\", \"Consent given\" or \"Client refused\".",
          "For a breach, press \"Record breach register details\", fill \"Data involved\", \"Cause\" and \"Action taken\", press \"Save details\".",
          "Press \"Close\" when done (a note is needed)."
        ]
      },
      {
        "task": "How to keep the register and consents",
        "steps": [
          "In \"Data register\" press \"Add entry\", fill it, press \"Save\"; later \"Mark reviewed\".",
          "In \"Consents\" press \"Record consent\", attach the signed form, press \"Record consent\"."
        ]
      },
      {
        "task": "How to log a data request",
        "steps": [
          "Open \"Data requests\", press \"Log a request\", fill it, press \"Log request\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "PDPA",
        "means": "Malaysia's Personal Data Protection Act."
      },
      {
        "term": "PDP Commissioner",
        "means": "The government office told about breaches."
      },
      {
        "term": "DPO",
        "means": "Data protection officer."
      }
    ],
    "notes": "A breach goes to the PDP Commissioner within 72 hours, and to affected people within 7 days after that when harm is significant. Those steps and \"Consent given\" need proof first. Use the staff or guard number for consents, never the IC. Changing settings needs a \"Reason for the change\". With PDPA off, alerts stop on leaders' screens but duties stay. Without the officer role you see \"Steps\" instead of \"Act\"."
  },
  {
    "view": "clients",
    "title": "Clients",
    "what": "The list of the company's clients and how each relationship is going: onboarding, visits, reports, satisfaction, complaints, billing, the client's signed acknowledgement of each month's work, contracts and leaving.",
    "who": "Directors, group officers, company managers, admin executives and supervisors. Operations Managers, the Operations Director and officers act on clients; the COO and company managers mainly monitor. Billing boxes show only to people allowed to record billing. The \"Group\" tab is for group leadership only.",
    "tabs": [
      {
        "name": "Client board",
        "what": "All clients with filters, their checklists and the update box."
      },
      {
        "name": "Pipeline",
        "what": "From first lead to client, including won work not yet opened as a client."
      },
      {
        "name": "Renewals",
        "what": "Contracts ending soon and the next renewal step."
      },
      {
        "name": "Requests and complaints",
        "what": "Open client requests and complaints, with overdue ones marked."
      },
      {
        "name": "Lost clients",
        "what": "Why clients left and the clients leaving or ended."
      },
      {
        "name": "Group",
        "what": "A view across all group companies, for group leadership."
      }
    ],
    "tasks": [
      {
        "task": "How to add a new client",
        "steps": [
          "Press \"New client\".",
          "Fill in \"Client name\", tick the sites, and add \"Contract ends (if known)\".",
          "Press \"Save client\". Onboarding starts with every step open."
        ]
      },
      {
        "task": "How to find a client",
        "steps": [
          "On \"Client board\", type in the search box (client or company).",
          "Use the filters \"Needs attention\", \"Onboarding\", \"Offboarding\" or \"All\".",
          "Tap the client to open its details."
        ]
      },
      {
        "task": "How to log a visit, meeting or call",
        "steps": [
          "Open the client.",
          "Under \"Record an update\", write a \"Note\".",
          "Choose \"Contact\" (Visit, Meeting or Call) and press \"Log contact\"."
        ]
      },
      {
        "task": "How to save a satisfaction rating or complaint",
        "steps": [
          "Open the client and fill in \"Who at the client\" and \"How they said it\".",
          "Pick a score from 1 to 5 under \"Satisfaction\" and press \"Save rating\".",
          "For a complaint, write it in \"Note\" and press \"Log complaint (in the note)\"."
        ]
      },
      {
        "task": "How to record an invoice sent",
        "steps": [
          "Open the client and go to \"Money\".",
          "Under \"Record an invoice sent\", choose \"Invoice month\" and \"Sent\".",
          "Add the proof and press \"Record\"."
        ]
      },
      {
        "task": "How to record the client's acknowledgement of a month's work",
        "steps": [
          "Open the client and go to \"Money\".",
          "In the acknowledgement box (due by the 10th), fill in \"Month of work\", \"Date signed\", \"Signed by\" and \"Client's view\".",
          "Copy the client's words into \"Client's comment\" (or write \"No comment written\"). For complaints, also fill in \"What will be done\".",
          "Attach the slip or the signed paper (needed) and press \"Record acknowledgement\"."
        ]
      },
      {
        "task": "How to open a won lead as a client",
        "steps": [
          "Go to the \"Pipeline\" tab.",
          "Under \"Won, client not opened yet\", press \"Open as client\".",
          "Tick the sites, add the contract end date and press \"Open client and start onboarding\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Onboarding",
        "means": "The start-up checklist for a new client: contract, survey, award, deployment, billing and PDPA."
      },
      {
        "term": "Offboarding",
        "means": "The checklist when a client is leaving."
      },
      {
        "term": "Unknown",
        "means": "Never visited, rated or billed on record. It is never shown as fine."
      },
      {
        "term": "Client report links",
        "means": "A read-only web page for the client for one period, with no staff names or amounts owed."
      },
      {
        "term": "Work acknowledgement",
        "means": "The client's signed slip or paper for a month's work, with their comment, uploaded by the 10th after the month closes."
      }
    ],
    "notes": "\"New client\" only shows for people allowed to add clients. The update box only shows if you may act on that client; others see \"not done\" on open steps. Billing shows \"unknown (SQL Account not connected)\" when no billing is on record. Report links may say they are switched off on this server. A report link is shown once; make a new one if lost. The acknowledgement box shows only to people allowed to record billing. In a client opened from the lifecycle tabs, tap a contract reference to open it in Contracts; \"Record the signed contract\" starts a new contract for that client."
  },
  {
    "view": "requests",
    "title": "Requests",
    "what": "Operation claims and office requests (office supplies, utilities and rent), and their approvals. The page is titled \"Claims and requests\".",
    "who": "The Operations Manager makes operation claims and the COO approves. The company manager makes office requests, the Chief of Staff approves, and the COO gives the final approval.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to make a new request",
        "steps": [
          "Press \"New operation claim\" or \"New office request\".",
          "Choose \"Company\", \"Month\" and, for office, \"Category\".",
          "Under \"Items\", fill \"Item\", the RM amount and \"Note\"; press \"Add item\" for more. Attach the receipt.",
          "Press \"Save\" (it is a draft), then open it and press \"Submit\"."
        ]
      },
      {
        "task": "How to start rent or utilities from last month",
        "steps": [
          "In \"Start from last month\", press \"Rent from last month\" or \"Utilities from last month\".",
          "Check the amount, attach this month's bill and submit."
        ]
      },
      {
        "task": "How to decide a request",
        "steps": [
          "Press \"Waiting for me\", then \"Act\" on the request.",
          "Type a reason under \"Your decision\".",
          "Press \"Approve\", \"Send back\" or \"Reject\"."
        ]
      },
      {
        "task": "How to fix a request sent back",
        "steps": [
          "Open it, press \"Edit items\", change it and press \"Save\".",
          "Press \"Submit\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Operation claim",
        "means": "The month's operating costs claimed by the Operations Manager."
      },
      {
        "term": "Consumables",
        "means": "Items used up, not IT or assets like furniture or renovation."
      }
    ],
    "notes": "\"Save\" only keeps a draft; nothing moves until you press \"Submit\". Office supplies must be consumables; tick the box that says so. A reason is always needed to decide, and at least 3 letters to send back or reject. Buttons to create show only for the Operations Manager or company manager."
  },
  {
    "view": "payreq",
    "title": "Payment requests",
    "what": "Ask for a payment and follow it through its approvals until Finance pays.",
    "who": "The company head creates the request. The head of that department approves, Finance checks the calculation, and the COO (or the Finance Director, for Finance) gives the final approval. Finance then pays. Others in the chain see it in their menu.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to create a payment request",
        "steps": [
          "Press \"New payment request\".",
          "Choose \"What it is for\" (and \"Sites\" for operations); the approval chain shows below.",
          "Fill \"What the payment is\", \"Why it is needed\", \"Amount (RM)\", \"Needed by\", \"How the amount was worked out (Finance checks it)\", \"Who is paid\" and the supporting documents.",
          "Press \"Create request\"."
        ]
      },
      {
        "task": "How to act on a request",
        "steps": [
          "Open it under \"Waiting for you\".",
          "Type a comment (always needed; a return needs the reason).",
          "Press \"Approve as department head\", \"Calculation is correct\", \"Approve\", \"Return\" or \"Cancel\"."
        ]
      },
      {
        "task": "How to fix a returned request",
        "steps": [
          "Press \"Edit\" on the returned request.",
          "Correct the boxes and type \"What you changed\".",
          "Press \"Save and resubmit\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Chain",
        "means": "The people who must approve, in order."
      },
      {
        "term": "Returned",
        "means": "Sent back to the company head to fix; the whole chain starts again."
      }
    ],
    "notes": "Nobody acts twice on one request. The final approval is also the payment's approval. Never put bank passwords or account numbers in the documents box. \"New payment request\" shows only for those who may create one."
  },
  {
    "view": "fleet",
    "title": "Vehicles",
    "what": "Company vehicles: renewals, servicing, payments, trips out and in, fuel and usage, and vehicles rented between companies. Staff request a vehicle here.",
    "who": "Transport and group leaders see the full set of tabs. \"Rented vehicles\" also shows for the CEO, the COO, the OGM and the Finance Director. CMS sees \"Monitor\" and \"Trips and driving hours\". The PDPA officer sees \"Driver consent\". Everyone else sees \"My requests\". Only Transport logs vehicles out and in and approves requests.",
    "tabs": [
      {
        "name": "Reminders",
        "what": "Renewals, servicing and payments due."
      },
      {
        "name": "Vehicles",
        "what": "Every vehicle; open one to log it out or in and record work."
      },
      {
        "name": "Requests",
        "what": "Vehicle requests from staff."
      },
      {
        "name": "Monitor",
        "what": "Trackers, dashcams and driver health."
      },
      {
        "name": "Trips and driving hours",
        "what": "Driver alerts and driving hours today."
      },
      {
        "name": "Fuel and usage",
        "what": "Fill-ups, fuel cards and tracker distance per vehicle, and fill-ups to review."
      },
      {
        "name": "Rented vehicles",
        "what": "Which company uses each rented vehicle, the rent, and the month's draft rent bills."
      },
      {
        "name": "Driver consent",
        "what": "Drivers who still need a signed consent to monitoring."
      },
      {
        "name": "My requests",
        "what": "Ask for a vehicle and record fill-ups of a vehicle out with you."
      }
    ],
    "tasks": [
      {
        "task": "How to request a vehicle",
        "steps": [
          "Open \"My requests\", fill in \"What it is for\", \"From\" and \"To\".",
          "Choose a \"Vehicle\" or leave \"Any vehicle (Transport chooses)\", then press \"Send request\"."
        ]
      },
      {
        "task": "How to approve or reject a request (Transport)",
        "steps": [
          "Open \"Requests\", choose the vehicle and write a comment (a comment is needed to approve).",
          "Press \"Approve\" or \"Reject\"."
        ]
      },
      {
        "task": "How to log a vehicle out or in (Transport)",
        "steps": [
          "Open \"Vehicles\" and tap the vehicle.",
          "Going out: choose the \"Approved request\" (or name the \"Driver\"), enter \"Odometer km\", press \"Log out\".",
          "Coming back: enter \"Odometer km\" and a \"Condition note\", press \"Log in\"."
        ]
      },
      {
        "task": "How to record a fill-up",
        "steps": [
          "Driver: in \"My requests\" press \"Record fill-up\". Transport: in \"Fuel and usage\" press \"Record fill-up\" on the vehicle.",
          "Fill in the receipt details, attach the receipt and press \"Save fill-up\". Without a receipt it is flagged for review."
        ]
      },
      {
        "task": "How to record a rented vehicle (Transport)",
        "steps": [
          "Open \"Rented vehicles\", choose the vehicle, owner and date, write the reason and press \"Record rented vehicle\".",
          "Use \"Move to another company\" or \"End rental\" later; every change needs a reason. The Finance Director or the CEO uses \"Set rent\"."
        ]
      },
      {
        "task": "How to file a driver's consent (PDPA officer)",
        "steps": [
          "Open \"Driver consent\", attach the signed consent and press \"File consent\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Unknown (device)",
        "means": "The device is not connected or silent for over 30 minutes. Never treated as fine."
      }
    ],
    "notes": "Tracker, dashcam and driver health devices are not connected yet, so they show as unknown. Driving limits shown are proposed. Vehicle rent bills are a draft for Finance, not an invoice."
  },
  {
    "view": "ja",
    "title": "JA app data",
    "what": "Guards and officers use the JA Group app. Their payroll, foreign worker papers, incidents and guard records come here from its feed, read-only.",
    "who": "Directors, group officers, company managers, admin executives and supervisors, for Operations, HR, foreign workers and CMS. Which datasets (and tabs) you see depends on your role.",
    "tabs": [
      {
        "name": "Feed",
        "what": "Whether each company's data is current or late, and each delivery the JA app sent."
      },
      {
        "name": "Payroll",
        "what": "Guard payroll per month, paid or not, and SOCSO, LINDUNG and EIS."
      },
      {
        "name": "Foreign workers",
        "what": "Foreign worker papers due soon with no renewal submitted."
      },
      {
        "name": "Incidents",
        "what": "Incidents reported, escalated and closed in the JA app."
      },
      {
        "name": "Guards",
        "what": "Guards by company, and anyone with basic pay below the minimum wage."
      }
    ],
    "tasks": [
      {
        "task": "How to see which companies' data is late",
        "steps": [
          "Tap \"Feeds late or missing\", or open \"Feed\"."
        ]
      },
      {
        "task": "How to check payroll was paid on time",
        "steps": [
          "Tap \"Payroll not paid by the 7th\", or open \"Payroll\". Companies not sent at all are listed in red at the top."
        ]
      },
      {
        "task": "How to see papers about to expire",
        "steps": [
          "Tap \"Papers due\", or open \"Foreign workers\"."
        ]
      },
      {
        "task": "How to fix a wrong record",
        "steps": [
          "Correct it in the JA Group app. It arrives here with the next feed; nothing is changed on this page."
        ]
      }
    ],
    "terms": [
      {
        "term": "Feed",
        "means": "The data the JA Group app sends to Prima."
      },
      {
        "term": "Unknown, feed late",
        "means": "No data from that company for too long. It is shown as unknown, never as fine."
      },
      {
        "term": "P1 / P2",
        "means": "The most serious incidents."
      }
    ],
    "notes": "This is a preview with test data: the JA feed is not live yet, so Prima's own foreign worker, incident, pay and hostel screens stay on until it is. Nothing can be added or edited here. If there are no tabs, you only have one dataset."
  },
  {
    "view": "jaswitch",
    "title": "Switch from JA",
    "what": "Moves one company and one area at a time from the JA app to Prima. Both run side by side, every difference is explained or fixed, ACT checks the report, then the CEO switches. A switch can be undone.",
    "who": "Directors, group leaders, company managers, ACT, HR, FWM and operations from OM up. Not admin executives or supervisors. The CEO or COO start and stop runs; the ACT Lead checks reports and approves JA files; only the CEO switches.",
    "tabs": [
      {
        "name": "Areas",
        "what": "Each company's areas and their difference reports."
      },
      {
        "name": "JA files",
        "what": "JA export files waiting for a second person."
      },
      {
        "name": "Guard history",
        "what": "A guard's history brought across from JA."
      },
      {
        "name": "Numbers",
        "what": "Switch-over numbers set by the ACT Director."
      }
    ],
    "tasks": [
      {
        "task": "How to start a side-by-side run (CEO or COO)",
        "steps": [
          "In \"Areas\" press \"Start side by side\".",
          "Set the \"First day\" and a note.",
          "Press \"Start\"."
        ]
      },
      {
        "task": "How to explain a difference",
        "steps": [
          "Press \"Open report\" on the area.",
          "Press \"Explain\" on a difference.",
          "Choose \"Explained\" or \"Fixed\", write what happened, and press \"Save\"."
        ]
      },
      {
        "task": "How to check and switch",
        "steps": [
          "ACT Lead: in the report write the \"ACT note\" and press \"Mark report checked\".",
          "CEO: write the reason and press \"Switch this area to Prima\".",
          "To undo, the CEO presses \"Switch back to JA\"."
        ]
      },
      {
        "task": "How to stage a JA file (ACT)",
        "steps": [
          "Open \"JA files\".",
          "In \"Stage a JA export\" choose the company, \"What the file holds\", the first and last day, and the CSV file.",
          "Press \"Stage file\". The ACT Lead then presses \"Approve\" or \"Reject\"."
        ]
      },
      {
        "task": "How to look up a guard's JA history",
        "steps": [
          "Open \"Guard history\".",
          "Choose the company and type the \"Staff number\".",
          "Press \"Look up\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Side by side",
        "means": "Prima and JA run the same days so their results can be compared."
      }
    ],
    "notes": "This is test data. JA stays the real system for guards. Switching records the decision; it does not turn screens on or off, and Prima cannot make JA read-only. For guard pay you may see \"The guard pay run's database part is not installed, so guard pay cannot be compared yet.\" Days with no approved JA file are unknown, not matching."
  },
  {
    "view": "assets",
    "title": "Asset Management",
    "what": "The group's rental units, furniture and fittings, resorts, orchards and training facility: rent, repairs, contractors, tenants, meters, bookings, harvests, the asset register and purchases.",
    "who": "Only the Asset Management team, group leadership and the finance staff who oversee it. The Asset Director approves letters, reversals, contractors, offers and BQs. Finance confirms payments in the bank. The Finance Director or the COO decides disposals.",
    "tabs": [
      {
        "name": "Overview",
        "what": "What needs attention, and rent billed and collected."
      },
      {
        "name": "Units",
        "what": "Every rental unit with status, rent and tenant."
      },
      {
        "name": "Monthly rent",
        "what": "Each let unit for one month: paid or not, and updates due."
      },
      {
        "name": "Rent and arrears",
        "what": "Arrears, record a payment, letters and reversals to approve, payments to confirm in the bank."
      },
      {
        "name": "Maintenance",
        "what": "Work orders; press \"BQ\" on a job for its bill of quantities, quotes, award and variation orders."
      },
      {
        "name": "Assets",
        "what": "Furniture, fittings and renovations; start a disposal."
      },
      {
        "name": "Depreciation and disposal",
        "what": "Monthly depreciation and disposals."
      },
      {
        "name": "Resorts, orchards, training",
        "what": "Read-only monthly figures and licences."
      },
      {
        "name": "System check",
        "what": "Where the Asset Management system and Prima disagree."
      },
      {
        "name": "Purchases",
        "what": "Purchase requests and the \"Ask to buy\" form."
      },
      {
        "name": "Contractors",
        "what": "The approved contractors list and job ratings."
      },
      {
        "name": "Finding tenants",
        "what": "Adverts, enquiries, offers and signing for empty units."
      },
      {
        "name": "Meters",
        "what": "Utility meter readings and bills."
      },
      {
        "name": "Resort bookings",
        "what": "Bookings, check-in, check-out, payments and room cleaning."
      },
      {
        "name": "Harvest",
        "what": "Orchard picks and sales."
      },
      {
        "name": "Planned maintenance",
        "what": "Regular jobs and when they fall due."
      }
    ],
    "tasks": [
      {
        "task": "How to record a rent payment",
        "steps": [
          "Open \"Rent and arrears\". In \"Record a payment\", search the tenant or unit code and tap it.",
          "Fill \"Amount received\", \"How it was paid\" and \"Date received\".",
          "Press \"Record payment\". The app numbers the official receipt."
        ]
      },
      {
        "task": "How to follow up a tenant who has not paid",
        "steps": [
          "Open \"Monthly rent\" and press \"Contact or record payment\" on the unit.",
          "Use \"Call\", \"WhatsApp\" or \"Email\", choose \"What was done\", write what happened and press \"Record follow-up\"."
        ]
      },
      {
        "task": "How to approve a letter or a reversal (Asset Director)",
        "steps": [
          "Open \"Rent and arrears\" and find \"Letters waiting for the Asset Director\" or \"Reversals waiting for the Asset Director\".",
          "Write a comment in \"Note\" (a comment is needed to approve).",
          "Press \"Approve\" or \"Stop\" for a letter, \"Approve reversal\" for a reversal."
        ]
      },
      {
        "task": "How to prepare a BQ for a repair",
        "steps": [
          "Open \"Maintenance\" and press \"BQ\" on the work order.",
          "Press \"Draft from template\" or \"Add line\", then \"Save BQ\" and \"Send for approval\".",
          "Use \"Record a quote\" for each quote, then \"Ask to award\". Later changes go through \"Raise a variation order\"."
        ]
      },
      {
        "task": "How to ask to buy furniture or fittings",
        "steps": [
          "Open \"Purchases\", fill \"What to buy\", \"Quantity\", \"Estimated cost (RM)\" and \"Reason\", and press \"Ask\".",
          "When bought, fill \"Asset tag\", \"Actual cost (RM)\" and \"Bought on\", then press \"Received\"."
        ]
      },
      {
        "task": "How to dispose of an asset",
        "steps": [
          "Open \"Assets\", find the item and press \"Dispose…\".",
          "Fill \"Reason\", \"Method\" and \"Expected proceeds (RM)\", then press \"Ask to dispose\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Update every 10 days",
        "means": "Until a unit is paid, the team must contact the tenant and record it at least every 10 days."
      },
      {
        "term": "BQ",
        "means": "Bill of quantities: the work and prices for a job sent to contractors. The lowest complete quote wins unless a reason is approved."
      },
      {
        "term": "VO",
        "means": "Variation order: a change of work or price after the award."
      }
    ],
    "notes": "This is a test version on made-up data; the Asset Management system will send the real figures. \"WhatsApp rent reminders\" are not sent until WhatsApp Business is connected. Computers and electronics are not on this register."
  },
  {
    "view": "contracts",
    "title": "Contracts",
    "what": "Signed contracts and letters of award, and the work to get each site ready (mobilisation), including later expansions. Each contract shows its terms, billing, reviews after go-live, papers and proof, and the assignment instructions for its sites.",
    "who": "Directors, group officers, company managers, admin executives and Operations staff. The company manager records contracts, mobilises, signs Ready-to-Operate, goes live, suspends and ends contracts, and records variations and renewals. Staff can mark mobilisation items and reviews done. \"New contract\" shows only for people allowed to record contracts.",
    "tabs": [
      {
        "name": "Needs attention",
        "what": "Contracts with a problem, a review due or an invoice that does not match."
      },
      {
        "name": "Mobilising",
        "what": "Contracts awarded, being mobilised or ready to start."
      },
      {
        "name": "Live",
        "what": "Contracts running now."
      },
      {
        "name": "All",
        "what": "Every contract."
      }
    ],
    "tasks": [
      {
        "task": "How to record a new contract",
        "steps": [
          "Press \"New contract\" (or \"Record the signed contract\" from the client in Clients).",
          "Choose the \"Paper\": \"Signed contract\" or \"Letter of award (contract to follow)\".",
          "Under \"Copy of the signed paper (PDF best)\", attach the copy. It is needed to save.",
          "If you like, press \"Read the attached copy\" (or \"Paste the text instead\"). Prima suggests values; check each and press \"Use\".",
          "Choose the \"Client\" (or type the \"Client name\"), tick the sites, and fill in \"Starts\" and \"Ends\".",
          "Choose the \"Billing method\", fill in the rate, posts or fee, then the service levels, payment, notice and any bond.",
          "Fill in the \"Signed contract reference\" (or \"Letter of award reference\") and press \"Save contract\". Mobilisation opens."
        ]
      },
      {
        "task": "How to work through mobilisation",
        "steps": [
          "Tap the contract to open it. Under \"Mobilisation\", pick \"First mobilisation\" or the expansion if there is more than one round.",
          "Press \"Mark done\" on an item, attach the proof (needed) and press \"Save as done\". Items Prima checks itself show \"Mark done (checked)\".",
          "The company manager may press \"Accept risk\" on a non-critical item, fill in \"Why\" and \"Until\", then press \"Accept\", or press \"Add an item for this site\"."
        ]
      },
      {
        "task": "How to take a site live (company manager)",
        "steps": [
          "Open the contract and press \"Start mobilising\".",
          "When the critical items are done, press \"Sign Ready-to-Operate\" (for an expansion, \"Sign Ready-to-Operate for the expansion\").",
          "On or after the start date, press \"Go live\"."
        ]
      },
      {
        "task": "How to record a review after go-live",
        "steps": [
          "Open a live contract and go to \"Reviews after go-live\".",
          "Fill in \"What the review found\" (on day 30 also tick that the first invoice was checked).",
          "Press \"Record review\"."
        ]
      },
      {
        "task": "How to change billing or add sites (variation)",
        "steps": [
          "Open the contract and press \"Record a variation\".",
          "Fill in \"Billing method\" and the rate or fee. Tick any \"Sites the variation adds\" or \"More guards or armed posts: mobilise the change before it starts\"; either opens an expansion.",
          "Fill in \"Takes effect from\", \"Signed variation reference\" and \"What changes\", attach the signed copy, and press \"Save variation\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Mobilisation",
        "means": "Getting a new site ready, tracked against 12 workstreams."
      },
      {
        "term": "Ready-to-Operate",
        "means": "The certificate the company manager signs when the site is ready to start."
      },
      {
        "term": "Variation",
        "means": "A signed change to the contract; billing only changes this way."
      },
      {
        "term": "Expansion",
        "means": "Extra sites, guards or armed posts added to a contract by a variation; it is mobilised and signed ready on its own."
      }
    ],
    "notes": "\"Sign Ready-to-Operate\" waits until every critical item is done and other items due by the start are done or their risk accepted. \"Go live\" waits for the start date. \"Suspend\" and \"End contract\" need a note. A new contract, a variation and a renewal each need the signed copy. The paper reader cannot read a scanned paper or photo. For a renewal press \"Record a renewal\"; if the contract shows \"Not tied to a client\", press \"Tie to a client\". Press \"Show\" beside \"Papers and proof\" to see the copies. Under \"Assignment instructions\", press \"Write instructions\" for each site."
  },
  {
    "view": "branches",
    "title": "Branches",
    "what": "Shows each company's branches. A branch works inside its licensed company; the company approves each month's settlement and reviews what the branch did. Prima records payments; it never makes them.",
    "who": "Directors, PWVSB officers, company managers and admin executives. The company manager approves settlements, reviews branch actions, activates a branch, and handles step-in and closing. Finance verifies accounts, sets the SQL project code, validates months, records payments and branch cash. For a salaried branch the Finance Director sets the manager's salary and decides the payout; the CEO sets a JV branch's management fee. Branch staff prepare months and record papers.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to propose a new branch",
        "steps": [
          "Press \"Propose a new branch\".",
          "Fill in \"Branch name\", \"State\" and \"Model\" (and \"Company\" if you have more than one).",
          "Press \"Propose\". It starts as proposed."
        ]
      },
      {
        "task": "How to approve a month's settlement",
        "steps": [
          "Tap the branch to open it.",
          "Check the settlement figures and any hold notices.",
          "Type a comment.",
          "Press \"Approve settlement\"."
        ]
      },
      {
        "task": "How to review a branch action",
        "steps": [
          "Open the branch.",
          "Under \"Branch actions to review\", read the action.",
          "Type a comment (needed to accept or reverse).",
          "Press \"Accept\" (or \"Approve\"), or press \"Reverse\" (or \"Refuse\")."
        ]
      },
      {
        "task": "How to prepare a month",
        "steps": [
          "Open the branch.",
          "Under \"Months\", press \"Prepare a month\".",
          "Choose the \"Month\" and fill the payroll reference.",
          "Add lines with the SQL Account document reference and amount; press \"Add line\" for more.",
          "Press \"Submit for approval\"."
        ]
      },
      {
        "task": "How to activate a proposed branch",
        "steps": [
          "Open the branch.",
          "Under \"Papers and accounts\", use \"Record papers\" and \"Add an account\" until nothing is listed under \"Before activation\".",
          "Type a comment and press \"Activate branch\"."
        ]
      },
      {
        "task": "How to decide a salaried branch's payout (Finance Director)",
        "steps": [
          "Open the branch and find the month marked \"Validated, Finance Director to decide the payout\".",
          "Type the payout in RM (0 when nothing is paid out); for a payout above 0 also type the bank reference.",
          "Type a comment and press \"Approve payout\" (or \"Close month (nothing paid out)\")."
        ]
      },
      {
        "task": "How to ask for a purchase in a salaried branch",
        "steps": [
          "Open the branch and go to \"Salaried branch: manager, purchases and expenses\".",
          "Open \"Ask the company for a purchase or an expense\", fill it in and press \"Send request\".",
          "The deciders type a comment (needed) and press \"Consent\" or \"Approve\" (or \"Decline\" or \"Refuse\"). After buying, press \"Record invoice\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Settlement",
        "means": "The monthly split of the branch's money between the company and the Branch Manager."
      },
      {
        "term": "Model A / B / C",
        "means": "A: company keeps a signed % of billing. B: salaried Branch Manager. C: company keeps a signed % of net profit."
      },
      {
        "term": "Held",
        "means": "The share payout is stopped (agreement, bank, wages or licence issue). Wages are never held."
      },
      {
        "term": "Step in",
        "means": "The company takes over running the branch for a time."
      },
      {
        "term": "SQL Account",
        "means": "The accounting system. Month lines must quote its document numbers."
      },
      {
        "term": "JV branch",
        "means": "A Model A or C branch the Branch Manager runs: buys from any supplier and sets branch staff pay; the company and HR see the records."
      },
      {
        "term": "Salaried branch",
        "means": "A Model B branch the company runs; purchases and expenses follow the approval style the Finance Director sets."
      }
    ],
    "notes": "\"Propose a new branch\" only shows if you are allowed to add a branch for a company. Approve, activate, step-in and closing buttons show only for the company manager. Approving a settlement, activating a branch and reviewing an action each need a comment. \"Activate branch\" stays greyed out until all papers and a verified bank account are recorded. In a JV branch, \"Record a purchase\" logs what the Branch Manager bought; the company may \"Ask\" about it but does not block it. \"Branch cash\" shows only when Finance has figures; with nothing recent it shows \"Unknown\". Months marked \"Test figures\" were not prepared from SQL Account lines."
  },
  {
    "view": "finance",
    "title": "Finance",
    "what": "Shows whether each company's books are complete, reconciled and closed, plus payments, the month-end close and papers for the auditor and tax agent. The books stay in SQL Account.",
    "who": "The Finance Director, the CEO, the Chairman and Vice Chairman, the ACT head and Finance team members. Data entry prepares, the deputy reviews, the team leader and Finance Director send. The COO sees a different page here, \"Payments to approve\": his payments waiting for him, each with \"Approve\" or \"Return\" and a comment.",
    "tabs": [
      {
        "name": "Overview",
        "what": "Every company by team, worst first."
      },
      {
        "name": "Dashboard",
        "what": "Key numbers such as cash in the bank."
      },
      {
        "name": "Payments",
        "what": "Payments waiting for you, returned or to release."
      },
      {
        "name": "Month-end close",
        "what": "Each company's close checklist."
      },
      {
        "name": "Bank reconciliation",
        "what": "Bank accounts not yet reconciled."
      },
      {
        "name": "Closing and posting",
        "what": "Companies not closed or failing tests."
      },
      {
        "name": "Auditor and tax",
        "what": "Papers overdue or due soon."
      },
      {
        "name": "Checks",
        "what": "Monthly checks around the books."
      },
      {
        "name": "KPIs",
        "what": "Speed and quality; leaders, the Finance Director and the CEO only."
      },
      {
        "name": "Settings",
        "what": "Rules, teams and their companies."
      }
    ],
    "tasks": [
      {
        "task": "How to prepare a new payment",
        "steps": [
          "Press \"New payment\".",
          "Choose \"Company\" and \"Pay to\" (only verified payees can be approved).",
          "Fill in \"Purpose\", \"Amount (RM)\", \"Due date\", \"Pay from\" and the document numbers.",
          "Press \"Prepare payment\". Someone else reviews and approves it."
        ]
      },
      {
        "task": "How to review or approve a payment",
        "steps": [
          "Open the \"Payments\" tab and press the payment under \"Waiting for you\".",
          "Write a comment (needed).",
          "Press \"Review\", \"Approve\" or \"Return\" (a return needs at least 10 characters).",
          "A returned payment can be fixed with \"Edit and resubmit\"."
        ]
      },
      {
        "task": "How to add a paper for the auditor or tax agent",
        "steps": [
          "Press \"Add paper\".",
          "Choose \"Company\" and \"For\", fill in \"What the paper is\" and \"Due\".",
          "Press \"Add paper\"."
        ]
      },
      {
        "task": "How to close a month for a company",
        "steps": [
          "Open \"Month-end close\" and press the company.",
          "Clear the checklist, write a comment and press \"Send for review\".",
          "The deputy or leader presses \"Mark reviewed\"; the Finance Director or the CEO presses \"Approve financials\"."
        ]
      },
      {
        "task": "How to set a management fee between group companies (Finance Director or CEO)",
        "steps": [
          "Under \"Management fees between group companies\", find the company and press \"Add a fee\" (or \"Change or end\").",
          "Choose who bills it, \"% of billing\" or \"RM a month\", the fee, the \"Agreement reference\" and the month it applies from.",
          "Give a reason and press \"Save\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "SQL Account",
        "means": "The accounting program where the real books are kept."
      },
      {
        "term": "Reconciled",
        "means": "The bank statement and the books agree."
      }
    ],
    "notes": "Test data: SQL Account is not connected yet. A company with no recent SQL figures shows as Unknown. \"New payment\", \"Add bank account\" and \"Add paper\" show only if you can act for a company; only the last 4 digits of a bank account are kept. \"Management fees between group companies\" and \"Management fee bills (draft)\" are for the Finance Director and the CEO only; every fee change is kept with its reason, and the bills are a draft for Finance to raise in SQL Account, not an invoice."
  },
  {
    "view": "credit",
    "title": "PWVSB credit",
    "what": "Tracks money PWVSB lends to a group company or pays on its behalf, the repayments, and what happens when an instalment is missed.",
    "who": "The credit officer records financing; Finance records repayments; legal and Finance can suspend or resume enforcement. The Deputy Chief of Staff records the KPKT licence check. Among PWVSB officers, only group leaders, the credit officer and legal see this page.",
    "tabs": [
      {
        "name": "Cases",
        "what": "Investigations and defaults from missed instalments."
      },
      {
        "name": "Loans",
        "what": "Each loan or amount paid on behalf, with its schedule."
      }
    ],
    "tasks": [
      {
        "task": "How to record new financing",
        "steps": [
          "Press \"Add financing\".",
          "Choose \"Company\" and \"Kind\" (Loan or Paid on behalf).",
          "Fill in \"Purpose\", \"Amount\", \"Rate % a year\", \"Start date\", \"Term in months\", \"Signed agreement reference\" and \"Collateral\".",
          "Press \"Record financing\"."
        ]
      },
      {
        "task": "How to record a repayment",
        "steps": [
          "Open the \"Loans\" tab and press the loan.",
          "Under \"Record a repayment\" choose the \"Instalment\".",
          "Fill in \"Amount received\", \"Paid on\" and \"Bank reference\".",
          "Press \"Record repayment\"."
        ]
      },
      {
        "task": "How to handle a missed instalment",
        "steps": [
          "Open the \"Cases\" tab and the case.",
          "Write a \"Note\". A note is needed to reconcile, confirm, clear or suspend.",
          "Press \"Bank reconciled\", \"Clear, not a default\", or \"Confirm default as ...\" depending on your part."
        ]
      },
      {
        "task": "How to run the daily check",
        "steps": [
          "Press \"Run the daily check\". Each missed instalment opens an investigation."
        ]
      }
    ],
    "terms": [
      {
        "term": "Default",
        "means": "A confirmed failure to pay, only after every check and each confirmation."
      },
      {
        "term": "Collateral",
        "means": "Security for the loan, such as a beneficial-interest agreement or a guarantee."
      },
      {
        "term": "SSM charge",
        "means": "A charge over a company asset lodged with SSM."
      }
    ],
    "notes": "Test data. A missed instalment opens an investigation, never a default. Prima never changes ownership. Enforcement steps 7 to 9 stay off until counsel approves the agreement template. \"Add financing\" shows only for the credit officer; \"Run the daily check\" for the credit officer and Finance. Legal and Finance use \"Suspend enforcement\" (a note is needed) and \"Resume\". Use \"Show cleared\" or \"Show settled\" to see finished items."
  },
  {
    "view": "grc",
    "title": "Speak up and assurance",
    "what": "A safe place to report wrongdoing (you can stay anonymous), follow your report with the handler, and declare gifts. Some staff also track what each company must prove and site risk assessments.",
    "who": "Most staff can report and declare gifts. \"Obligations\", \"Site safety\" and the numbers at the top show only for assurance roles; \"Reports to handle\" only for people who handle reports.",
    "tabs": [
      {
        "name": "Speak up",
        "what": "Send a report, check it with your receipt code."
      },
      {
        "name": "Gifts",
        "what": "Declare gifts or hospitality given or received."
      },
      {
        "name": "Obligations",
        "what": "What each company must prove, and if it was checked."
      },
      {
        "name": "Site safety",
        "what": "Site risk assessments (HIRARC)."
      },
      {
        "name": "Reports to handle",
        "what": "Reports you handle, messages to reporters, and closures to agree."
      }
    ],
    "tasks": [
      {
        "task": "How to report wrongdoing safely",
        "steps": [
          "Open \"Speak up\" and choose \"What is it about\" (and \"Which company\" if you want).",
          "In \"What happened\" write what, when, where and who was involved (at least 20 characters).",
          "If a listed person is involved, tick them. Your report will not go to them.",
          "Keep \"Do not record my name\" ticked to stay anonymous.",
          "Press \"Send report\" and write down the receipt code."
        ]
      },
      {
        "task": "How to check my report, answer the handler or report retaliation",
        "steps": [
          "Under \"Check a report\" type your receipt code and press \"Check\" to see the status, outcome and the handler's messages.",
          "Write in the box (at least 10 characters) and press \"Send answer\". Your name is not recorded.",
          "If you were treated badly for reporting, write what happened and press \"Report retaliation\". This still works for some days after the report closes."
        ]
      },
      {
        "task": "How to handle a report (handlers)",
        "steps": [
          "In \"Reports to handle\" press \"Acknowledge\", then \"Investigate\". Use \"Add note\" for notes.",
          "To ask the reporter something, write in \"Message to the reporter\" and press \"Send to reporter\".",
          "Write the outcome and press \"Propose closing\". A second handler presses \"Agree and close\" or \"Send back\"; a comment is needed for both."
        ]
      },
      {
        "task": "How to declare a gift",
        "steps": [
          "Open \"Gifts\" and press \"Declare a gift\".",
          "Fill in \"Given or received\", \"With whom\", \"Who they are\", \"What it was\", \"Value RM\" and \"Date\". Tick \"It was cash or a cash voucher\" if so.",
          "Press \"Declare\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Retaliation",
        "means": "Being treated badly for reporting. Nobody may punish you for reporting."
      },
      {
        "term": "HIRARC",
        "means": "A site's written risk assessment."
      }
    ],
    "notes": "A report never goes to anyone it names. Gifts above the limit, any gift with a public official, and any cash need a decision; cash is never kept. A comment is needed to approve: \"May keep\" for a gift, \"Accept proof\" for an obligation. Test data: the gift limit and acknowledgement time are proposals."
  },
  {
    "view": "act",
    "title": "ACT",
    "what": "ACT (Audit, Compliance and Transformation) watches compliance, audits each workflow, records problems as findings with an owner, checks the fix and leads improvements.",
    "who": "The ACT team (the Director, the ACT Manager and two teams, Team A and Team B, each with an Auditor and an Enforcement officer) see every tab; each team sees its own work, the Director and the ACT Manager see both. A high finding closes only after the ACT Manager's second check, never by the first checker or whoever raised it. Other people see only \"My findings\" and \"Improvements\": the findings ACT gave them to fix. \"Team work\" and \"Patterns and investigations\" are only for ACT.",
    "tabs": [
      {
        "name": "Compliance monitor",
        "what": "Counts of records breaking a rule today, by workflow."
      },
      {
        "name": "Team work",
        "what": "Work the ACT Director gave to each team."
      },
      {
        "name": "Monthly reports",
        "what": "Whether each department's and company's monthly report is in, on time and complete."
      },
      {
        "name": "Findings",
        "what": "All findings and where each one stands. Called \"My findings\" for owners."
      },
      {
        "name": "Workflow audits",
        "what": "The audit cycle for each workflow."
      },
      {
        "name": "Workflow timing",
        "what": "Timing targets and field checks."
      },
      {
        "name": "Improvements",
        "what": "Changes ACT leads, approved by the COO or CEO."
      },
      {
        "name": "Patterns and investigations",
        "what": "Patterns to check and open investigations."
      }
    ],
    "tasks": [
      {
        "task": "How to answer a finding given to me",
        "steps": [
          "Open \"My findings\" and find the finding.",
          "Under \"Your plan for the fix\" fill in \"Why it happened\", \"What you will change\" and \"Done by\".",
          "Also fill in \"Meanwhile\", \"Elsewhere\" and \"How we know it worked\" (optional, except on findings from a quality check).",
          "Press \"Save the plan\"."
        ]
      },
      {
        "task": "How to mark my fix as done",
        "steps": [
          "Open the finding.",
          "Under \"Mark it fixed\" write the proof (records, photos, new procedure).",
          "Press \"Mark fixed\". ACT then checks it before it closes."
        ]
      },
      {
        "task": "How to raise a finding (ACT)",
        "steps": [
          "Press \"Raise a finding\".",
          "Fill in \"Company\", \"Workflow\", \"What is wrong\", \"Evidence\", \"Severity\" and \"Owner\".",
          "Press \"Raise finding\"."
        ]
      },
      {
        "task": "How to check a fix (ACT)",
        "steps": [
          "Open the finding marked fixed.",
          "Write what you checked.",
          "Press \"Fix works, close\" or \"Not fixed\"."
        ]
      },
      {
        "task": "How to approve an improvement (COO or CEO)",
        "steps": [
          "In \"Improvements\" open one \"Waiting for approval\", write a comment (a comment is needed to approve) and press \"Approve\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Finding",
        "means": "A problem ACT found, with an owner who must fix it."
      },
      {
        "term": "Owner",
        "means": "The person responsible for fixing that finding."
      }
    ],
    "notes": "Test data. Nothing here is automatic discipline. Overdue findings go to the Chief of Staff, then the COO and the CEO. Only the ACT Director closes a high finding. If nothing is assigned to you, the page says \"No ACT findings or improvements are assigned to you.\""
  },
  {
    "view": "payformulas",
    "title": "Pay formulas",
    "what": "How guard salary, driver overtime and staff overtime are counted, and which formula is used for the whole group, a region, a company or a site.",
    "who": "The ACT Director sets formulas and where they are used. The ACT team prepares changes for the ACT Director. The CEO also sets the pay law settings. Group leadership can view.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find which formula pays a place",
        "steps": [
          "In \"Which formula pays here?\", choose the kind, company, site and month.",
          "Press \"Check\"."
        ]
      },
      {
        "task": "How to make or change a formula (ACT)",
        "steps": [
          "Press \"New guard salary formula\", \"New driver overtime formula\", \"New staff overtime formula\" or \"Change amounts\".",
          "Fill \"Name\", \"Starts from (month)\", the amounts and the reason.",
          "Press \"Send to the ACT Director\" (ACT team) or \"Set it live\" (ACT Director)."
        ]
      },
      {
        "task": "How to decide a change (ACT Director)",
        "steps": [
          "Press \"Decide\" under \"Changes waiting for the ACT Director\".",
          "Type the reason, press \"Set it live\" or \"Send back\"."
        ]
      },
      {
        "task": "How to choose the formula for a place (ACT Director)",
        "steps": [
          "In \"Where each formula is used\", choose kind, \"Applies to\", place, formula and month.",
          "Type a reason, press \"Save the choice\"."
        ]
      },
      {
        "task": "How to change pay law settings (CEO)",
        "steps": [
          "Press \"Change the pay law settings\", change the figures, press \"Save the pay law settings\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Daily rate",
        "means": "Basic pay divided by 26."
      },
      {
        "term": "Labour law flags",
        "means": "Warnings shown to the CEO when a formula is below a legal minimum."
      },
      {
        "term": "Set live",
        "means": "The formula is in use from its start month."
      }
    ],
    "notes": "The amounts are test placeholders until ACT sets the real ones. The narrowest choice wins (site before company, region, group). Going below a legal minimum is flagged to the CEO, never refused. A formula only counts pay; it pays nobody. Press \"Show a worked month\" to see an example. If the page says pay formulas are not switched on, nothing can be saved. Viewers without an ACT role see \"You can see the formulas. ACT sets them.\""
  },
  {
    "view": "sitehours",
    "title": "Site man-hours",
    "what": "Each site's allowed man-hours for the month against the hours rostered and worked, with a flag for any site going over. Extra hours must be approved with a reason before salary.",
    "who": "Directors, group officers, company managers and admin executives can see it. Only the Operations Director (private sites) or the OGM (government sites) approves extra hours; the page tells you which you are.",
    "tabs": [
      {
        "name": "Man-hours",
        "what": "Allowed, rostered and worked hours per site, and approvals."
      },
      {
        "name": "Public holidays",
        "what": "Each company's 11 paid public holidays for the year, by state."
      }
    ],
    "tasks": [
      {
        "task": "How to check which sites are over",
        "steps": [
          "Choose the company and the month.",
          "Read \"Sites to look at\". Press \"Show all ... sites\" to see every site.",
          "Press \"Show posts\" to see how a site's total is worked out."
        ]
      },
      {
        "task": "How to approve extra hours (Operations Director or OGM)",
        "steps": [
          "Find the flagged site.",
          "Enter \"Extra hours\", choose why, and write a \"Reason\".",
          "Press \"Approve extra hours\"."
        ]
      },
      {
        "task": "How to set next year's public holidays",
        "steps": [
          "Open \"Public holidays\" and choose the company and year.",
          "Press \"Set the 11 public holidays\" (or \"Change the list\").",
          "Enter each date and name; use \"Add a day (government-declared extra holiday)\" if needed.",
          "Write a reason and press \"Save the public holidays\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Man-hours",
        "means": "Guards per shift x hours covered a day x days in the month, for every post. Example: 2 guards on 12-hour shifts round the clock for 30 days is 4 people and 1,440 hours."
      },
      {
        "term": "Heading over",
        "means": "At the current pace the site will go over its total."
      },
      {
        "term": "Roster over the total",
        "means": "The roster already plans more hours than allowed."
      }
    ],
    "notes": "The page says it runs on test data. If you see \"Approvals are not switched on in this database yet\" (or the same for public holiday lists), nothing can be approved or set until the pay formulas module is installed with approval; hours are still counted. Approval and holiday buttons only show for the people allowed to use them."
  },
  {
    "view": "salarycalc",
    "title": "Salary calculator",
    "what": "A calculator that shows, step by step, how a guard's month is counted and what the guard takes home, so you know what to expect. Nothing is saved.",
    "who": "The OM and above, ACT and group leadership.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to work out a guard's month",
        "steps": [
          "In step 1 \"Formula and month\", choose the \"Formula\" and type the \"Basic pay a month\".",
          "In step 2 \"Days in the month\", fill \"Working days worked\" and any rest days, public holidays, training, leave or MC days. Type the number or tap the minus and plus buttons.",
          "Read \"Earnings\", \"Deductions\" and \"Employer pays on top\" below. The \"Net pay\" and \"Employer cost\" stay in view: on the right on a computer, in the bar at the bottom on a phone."
        ]
      },
      {
        "task": "How to change who the deduction estimate is for",
        "steps": [
          "In step 4 \"Deductions\", open \"Who the estimate is for\".",
          "Choose Malaysian or Nepali, under 60 or 60 or over, and tick the LINDUNG opt-out if the guard has the form on file."
        ]
      },
      {
        "task": "How to print the estimate",
        "steps": [
          "Tap \"Print estimate\". It prints a payslip-style page in the screen's language. Inside the phone app it is saved as a file instead.",
          "\"Start again\" puts every field back to the standard month."
        ]
      }
    ],
    "terms": [
      {
        "term": "Gross pay",
        "means": "Pay before EPF, SOCSO, EIS, LINDUNG and PCB are taken off."
      },
      {
        "term": "Net pay",
        "means": "Gross pay less the deductions: what the guard takes home."
      },
      {
        "term": "Employer cost",
        "means": "Gross pay plus what the employer pays on top (EPF, SOCSO, EIS and the HRD levy)."
      },
      {
        "term": "MC days",
        "means": "Sick days with a doctor's certificate; basic pay only."
      },
      {
        "term": "Rest day worked",
        "means": "Working on the weekly day off; paid extra."
      }
    ],
    "notes": "An estimate, not a payslip. Gross pay follows the formula exactly; the real pay run uses the formula ACT set for the guard's site. Deductions use the standard statutory rates and a single person's PCB; the pay run uses the CEO's statutory settings for the month and LHDN's e-PCB. A red line under a field says what to fix. The basic pay is a placeholder until ACT sets the real amount."
  },
  {
    "view": "governance",
    "title": "Mandates",
    "what": "The register of signed management agreements and board mandates that allow PWVSB to act in each company, and what PWVSB may do there.",
    "who": "PWVSB legal, the Chief of Staff and the owner add mandates. The company records its board's confirmation; PWVSB legal verifies the signed copy. Group leaders, legal officers and company managers can look.",
    "tabs": [
      {
        "name": "Mandates",
        "what": "Every agreement or mandate and its state."
      },
      {
        "name": "By company",
        "what": "What PWVSB may do in each company, from verified mandates only."
      },
      {
        "name": "Who approves what",
        "what": "Which matters the company controls and which PWVSB only monitors."
      }
    ],
    "tasks": [
      {
        "task": "How to add a mandate",
        "steps": [
          "Press \"Add mandate\".",
          "Fill in \"Company\", \"Kind\", \"Reference\", \"Title\", \"Signed on\", \"Runs from\" and \"Runs to\" (leave empty if it runs until ended).",
          "For each area under \"Powers the signed document gives PWVSB\" choose None, Monitor or Act.",
          "Press \"Add mandate\"."
        ]
      },
      {
        "task": "How to record the board's confirmation (company)",
        "steps": [
          "Open the mandate.",
          "Type the board resolution reference.",
          "Press \"Board confirmed it\"."
        ]
      },
      {
        "task": "How to verify the signed copy (legal)",
        "steps": [
          "Write what you checked.",
          "Press \"Signed copy verified\"."
        ]
      },
      {
        "task": "How to end a mandate",
        "steps": [
          "Write the reason it ended.",
          "Press \"Mark ended\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Mandate",
        "means": "Signed permission for PWVSB to act in a company."
      },
      {
        "term": "Unknown",
        "means": "No verified mandate on file, so PWVSB only monitors."
      }
    ],
    "notes": "Test data; the areas and wording are proposals for counsel. A mandate is in force only after the board confirms it and legal verifies it. The person who added it cannot verify it. \"Add mandate\" shows only for legal, the Chief of Staff and the owner. Ended ones are hidden until you press \"Show ended\"."
  },
  {
    "view": "corporate",
    "title": "Company secretary",
    "what": "Tracks each company's SSM filings and any change to its directors, shares, owners or other corporate details. Prima never lodges, signs or files anything.",
    "who": "Head office Corporate Admin (the Deputy Chief of Staff) and the people allowed for each company record filings; the company and the company secretary can view them. Companies ask for structure changes, and the Deputy Chief of Staff decides them for PWVSB. PWVSB legal sees a separate \"Audit and legal\" page with \"Legal matters\", \"Audit\" and \"Panel firms\".",
    "tabs": [
      {
        "name": "Filings",
        "what": "SSM filings by the month they fall due."
      },
      {
        "name": "Corporate changes",
        "what": "Changes waiting for PWVSB, approved, or done by the board."
      },
      {
        "name": "Audit",
        "what": "Statutory audits."
      },
      {
        "name": "Legal matters",
        "what": "Claims, demands and disputes, and legal holds."
      },
      {
        "name": "Companies",
        "what": "The company list."
      },
      {
        "name": "Company files",
        "what": "Directors, shareholders, owners and key papers."
      },
      {
        "name": "Panel firms",
        "what": "Outside firms the companies use."
      },
      {
        "name": "Delegations",
        "what": "Critical posts and who acts for whom."
      }
    ],
    "tasks": [
      {
        "task": "How to add a filing",
        "steps": [
          "Press \"Add filing\".",
          "Fill in \"Company\", \"What is being filed\", \"Title\", \"Due on\" and \"Deadline rule\".",
          "Press \"Add filing\"."
        ]
      },
      {
        "task": "How to move a filing along",
        "steps": [
          "Press \"Papers ready for the secretary\".",
          "When lodged, type the MBRS lodgement reference and press \"Secretary lodged it\".",
          "When SSM replies, type the SSM receipt number and press \"Record SSM receipt\"."
        ]
      },
      {
        "task": "How to ask for a corporate change",
        "steps": [
          "Press \"Ask for a change\".",
          "Fill in \"Company\", \"What changes\", \"Change\" and \"Details\".",
          "Press \"Send to PWVSB\"."
        ]
      },
      {
        "task": "How to decide a change (PWVSB)",
        "steps": [
          "Fill in \"Signed clause\" and \"Reason\".",
          "Press \"Approve\" or \"Reject\"."
        ]
      },
      {
        "task": "How to record the board resolution",
        "steps": [
          "After approval, fill in \"Resolution reference\" and \"Effective date\".",
          "Press \"Record board resolution\". The SSM filing then opens."
        ]
      }
    ],
    "terms": [
      {
        "term": "MBRS",
        "means": "The SSM online lodgement system the secretary uses."
      },
      {
        "term": "SSM receipt",
        "means": "SSM's acknowledgement that the filing was received."
      }
    ],
    "notes": "Test data; deadlines are for the secretaries to confirm. A filing stays waiting until the SSM receipt is recorded. \"Audit\" and \"Legal matters\" tabs show only if you may see them. \"Add filing\" and \"Ask for a change\" show only for companies you can act for."
  },
  {
    "view": "renewals",
    "title": "Renewals",
    "what": "Every licence, registration and certificate each company holds (KDN, MOF, council licences, ISO, fire certificate, insurance, SSM) and how each renewal is going.",
    "who": "Each company renews its own. Central Admin (the Deputy Chief of Staff) watches them all and confirms each new expiry. Admin executives, company managers, group leaders and audit staff use it. Which step buttons you see depends on your part.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find a licence",
        "steps": [
          "Type in \"Search licence, company or reference\".",
          "Or pick a company, or press a number at the top (Expired, Due, and so on) to show only those.",
          "Press \"Clear filter\" to see all again.",
          "Use \"By urgency\" or \"By company\" to change the grouping."
        ]
      },
      {
        "task": "How to renew a licence",
        "steps": [
          "Find the licence and press \"Open renewal\".",
          "Tick each paper as it is ready.",
          "The company manager presses \"Sign the application\".",
          "Record the fee (\"Record fee\"), then \"Record submission\".",
          "When the new certificate arrives, enter \"New expiry\" and press \"Record new certificate\".",
          "Central Admin presses \"Confirm new expiry\" or \"Query it\"."
        ]
      },
      {
        "task": "How to add a licence",
        "steps": [
          "Press \"Add licence\" and fill in the form."
        ]
      }
    ],
    "terms": [
      {
        "term": "Lead time",
        "means": "How early before expiry the renewal should start."
      },
      {
        "term": "No expiry on file",
        "means": "Prima has no expiry date, so it cannot say it is in date."
      }
    ],
    "notes": "Test data; lead times and paper lists are proposals. The app never lodges or pays. Licences in date are hidden until you press \"Show in date\". A red notice shows when a KDN licence is past expiry. Late renewals are stepped up to someone higher (\"Now with the ...\")."
  },
  {
    "view": "purchasing",
    "title": "Procurement",
    "what": "Buying operational and cleaning equipment for the group: quotes, approvals, ordering, receiving, suppliers and the store.",
    "who": "Staff and managers raise purchases. The Procurement executive gets the quotes; the COO then the CEO approve; a storekeeper receives and issues; Finance matches the invoice and checks suppliers. In operations, only the OGM and Operations Director see this page.",
    "tabs": [
      {
        "name": "Purchases",
        "what": "Purchases waiting for your approval, and all open ones."
      },
      {
        "name": "Suppliers",
        "what": "Approved suppliers and those with checks to finish."
      },
      {
        "name": "Store",
        "what": "Stock, items issued, returns, losses and counts."
      }
    ],
    "tasks": [
      {
        "task": "How to raise a purchase",
        "steps": [
          "Press \"New purchase\".",
          "Fill in \"Company\", \"What is being bought\" and \"Category\".",
          "Under \"Items\" fill in each line; press \"Add line\" for more.",
          "Press \"Raise purchase\"."
        ]
      },
      {
        "task": "How to add quotes and send for approval (Procurement)",
        "steps": [
          "Open the purchase.",
          "Under \"Add a supplier quote\" fill in \"Supplier\", \"Quoted amount\", \"Quotation ref\", attach the supplier's document and press \"Add quote\".",
          "Add the online price.",
          "Choose the quote and press \"Send for approval\"."
        ]
      },
      {
        "task": "How to approve a purchase",
        "steps": [
          "Open it under \"Waiting for your approval\" and check the quotes and online price.",
          "Write a comment; a comment is needed to approve or reject.",
          "Press \"Approve\" or \"Reject\"."
        ]
      },
      {
        "task": "How to check a supplier (Finance)",
        "steps": [
          "Open \"Suppliers\", write a comment (needed to verify or review).",
          "Press \"Bank verified against bank letter\", or \"Yearly review done (Finance)\" once Procurement has recorded \"Conflict declaration received\" and \"Anti-bribery signed\"."
        ]
      },
      {
        "task": "How to receive goods (storekeeper)",
        "steps": [
          "Open the ordered purchase.",
          "Enter quantities and a receipt note.",
          "Press \"Goods received\"."
        ]
      },
      {
        "task": "How to issue an item to a person",
        "steps": [
          "Open \"Store\", go to \"Issue to a person\".",
          "Find the person, choose the item and quantity.",
          "Press \"Issue\". The person confirms it in their own details."
        ]
      }
    ],
    "terms": [
      {
        "term": "Three-way match",
        "means": "Finance checks the order, the goods and the e-Invoice agree."
      },
      {
        "term": "PO number",
        "means": "The purchase order number."
      }
    ],
    "notes": "Test data. Every purchase needs the set number of quotes and an online price check; a quote far above it needs a reason. Nobody approves their own request, and an approver never receives the goods. A reported loss is settled with \"Confirm\" or \"Refuse\" (a note is needed). Uniforms and equipment are never charged to the guard. Finished purchases show with \"Show finished\"."
  },
  {
    "view": "items",
    "title": "Items and equipment",
    "what": "One register for every uniform, shoe, vest, radio, phone, IT device, office item and cleaning stock. Each item has one label for life: a QR code and a barcode of the same ID. Firearms stay in Arms control.",
    "who": "Guards, supervisors, directors, group officers, company managers and admin executives can open it. What you can do depends on your item role in each company (store, manager, operations, IT, Finance, view). Everyone sees \"My items\". Store, manager and IT people register, print labels, send and receive. Finance works only from export files.",
    "tabs": [
      {
        "name": "Find or scan",
        "what": "Scan or type a label to open the item's full record, with what you can do next."
      },
      {
        "name": "Stock and labels",
        "what": "Stock by owner, holder and condition; register items; labels still to print or scan back."
      },
      {
        "name": "Send and receive",
        "what": "Sales, rentals, loans, transfers and returns between companies, scanned out and in."
      },
      {
        "name": "Site board",
        "what": "What should be at a site, who holds it, and an audit scan."
      },
      {
        "name": "Counts",
        "what": "Stock counts by scanning, with recount and manager review."
      },
      {
        "name": "Cases",
        "what": "Differences (short, damaged, missing, wrong item) kept open until closed with a reason."
      },
      {
        "name": "After-sale care",
        "what": "Service due dates and expected life per item."
      },
      {
        "name": "Uniforms",
        "what": "Each guard's uniform allowance for the year."
      },
      {
        "name": "Item types",
        "what": "The item catalogue and how each company tags items."
      },
      {
        "name": "Reports",
        "what": "Ready reports with a CSV download."
      },
      {
        "name": "Finance and SQL",
        "what": "Export-only Finance board for SQL Account."
      },
      {
        "name": "My items",
        "what": "Items handed to you, waiting for your confirmation, or overdue back."
      }
    ],
    "tasks": [
      {
        "task": "How to scan a label",
        "steps": [
          "Open \"Find or scan\".",
          "Press \"Camera\". The back camera opens full screen; hold the label inside the frame and it reads on its own. Use the torch button if your phone has one, then press \"Done\".",
          "On a computer, click the box and scan with a USB or Bluetooth scanner, or type the ID printed under the code (P1-...) and press \"Enter\"."
        ]
      },
      {
        "task": "How to use a typed ID when a label will not scan",
        "steps": [
          "Type the ID and press \"Enter\".",
          "In \"The label could not be scanned\", pick why (\"Label damaged\", \"Label unreadable\", \"Label missing\" or \"Printer or scanner fault\").",
          "Enter the \"Maker serial you can see on the item\", or tick \"The item type and size match the ID I typed\".",
          "Press \"Use this ID\". It is marked as typed and asks for a new label."
        ]
      },
      {
        "task": "How to confirm an item I received",
        "steps": [
          "Open \"My items\" (or the item).",
          "Under \"Did you get this item?\", scan its label or press \"Yes, I have it\".",
          "If you did not get it, write what is wrong and press \"I did not get it\"."
        ]
      },
      {
        "task": "How to hand out, take back or report an item missing",
        "steps": [
          "Scan the item in \"Find or scan\".",
          "In \"What to do\", choose \"Hand to a person\", \"Place at a site\", \"Take back into the store\" or \"Report missing\".",
          "Fill in the person record ID, site ID, condition or note, and press \"Save\". A person handed an item confirms it in their own sign-in."
        ]
      },
      {
        "task": "How to register new items and print labels",
        "steps": [
          "Open \"Stock and labels\" and press \"Register items\".",
          "Choose \"Company\", \"Item type\" and \"How many units\"; add the order or delivery note.",
          "Press \"Register and print labels\".",
          "Under \"1. Print the labels\", choose the \"Label sheet\" (A4 sheet or label printer roll) and press \"Print ... labels\". Print at 100%.",
          "Under \"2. Scan each label back\", scan each label in slot order, then press \"Finished\"."
        ]
      },
      {
        "task": "How to reprint a label",
        "steps": [
          "Open the item and choose \"Reprint the label (same ID)\".",
          "Enter the maker serial or tick \"I checked the item type and size match\", write why, and press \"Print\". The old copy stops working."
        ]
      },
      {
        "task": "How to send items to another company or site",
        "steps": [
          "Open \"Send and receive\" and press \"New movement\".",
          "Choose the type (Sale, Rental, Loan, Transfer, Return to supplier), \"From\", \"To\" and the other details; add a pick list if you like.",
          "Scan each unit onto it, enter who carries it, and press \"Confirm it has left\"."
        ]
      },
      {
        "task": "How to receive a delivery",
        "steps": [
          "Open \"Send and receive\" and scan each item under \"Receive by scanning\", or open the movement and scan under \"Scan what arrived\".",
          "Mark any line \"Damaged\", \"Wrong item\", \"Missing\" or \"Leave waiting\".",
          "Press \"Save what arrived\"."
        ]
      },
      {
        "task": "How to do a stock count",
        "steps": [
          "Open \"Counts\". Choose \"Company\", \"Where\" and item types, and press \"Start count\".",
          "Keep scanning; each label counts once. Press \"Close the count\".",
          "Press \"Recount the differences\"; then a manager who did not count writes what they checked and presses \"Review and open cases\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Owner and holder",
        "means": "The company that owns an item and the one that has it now can be different."
      },
      {
        "term": "Scan back",
        "means": "Scanning a freshly printed label to prove it is on the right item. Only then is the item checked into stock."
      },
      {
        "term": "Old copy of the label",
        "means": "A label replaced by a reprint; it no longer moves the item."
      },
      {
        "term": "Not found yet",
        "means": "Not scanned in a count. It is not lost until recounted and reviewed."
      }
    ],
    "notes": "Nothing here is ever taken from pay: cases, missing items and write-offs never make a pay deduction, and uniform and item pay deductions are switched off until management and legal decide. A 4th or 5th uniform piece in 12 months is paid by the guard with their own receipt. SQL Account is not connected; Finance works from export files only. Tabs depend on your item role: with none you only see \"My items\". Label scan-back does not accept typed IDs. If the camera says \"This phone cannot read codes here\", type the ID or use a handheld scanner."
  },
  {
    "view": "it-extraction",
    "title": "AI data preview",
    "what": "Lets the CEO paste text about open IT work and get an AI preview of the help requests or jobs in it. It is a preview only; nothing is imported or saved.",
    "who": "Only the CEO's own account. Everyone else sees \"This import workspace is restricted to the exact CEO account.\"",
    "tabs": [],
    "tasks": [
      {
        "task": "How to get an AI preview",
        "steps": [
          "Choose \"Work type\" (Open help requests or Open IT jobs).",
          "Fill in \"Source label\" and choose \"Data permission\".",
          "Paste the text in \"Selected source text\".",
          "Tick the box approving sending this text to Azure OpenAI.",
          "Press \"Generate AI preview\"."
        ]
      },
      {
        "task": "How to review the result",
        "steps": [
          "Press \"Review proposed fields\" or \"Review with Arisha — local only\".",
          "Press \"Clear preview / cancel\" to start again."
        ]
      }
    ],
    "terms": [
      {
        "term": "Synthetic example",
        "means": "Made-up test text, not real data."
      }
    ],
    "notes": "AI extraction may be switched off or not approved; then nothing is sent. Never paste passwords, personal ID, bank, payroll, medical or whistleblowing details. Batch import stays unavailable until its separate review is complete. Sending text may cost usage charges."
  },
  {
    "view": "connections",
    "title": "Connections",
    "what": "Shows whether your Microsoft 365 (Outlook mail, calendar, Teams) is connected. Inside the Agentic Office you connect it once in the office, and Prima uses the same connection.",
    "who": "Every office staff member checks their own connection.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to connect Microsoft 365",
        "steps": [
          "Press \"Connect Microsoft 365\". It opens Mail in the office.",
          "Connect there once; Outlook, calendar and Teams then work in Prima too."
        ]
      },
      {
        "task": "How to fix a part marked \"Reconnect\"",
        "steps": [
          "Press \"Manage in the office\" and reconnect under Mail.",
          "Come back and press \"Refresh\"."
        ]
      },
      {
        "task": "How to disconnect or switch account",
        "steps": [
          "Do it in the office, under Mail."
        ]
      }
    ],
    "terms": [
      {
        "term": "Microsoft 365",
        "means": "Your work Outlook mail, calendar and Teams."
      }
    ],
    "notes": "\"What it covers\" shows Outlook mail, Calendar and Teams, each \"Ready\" or \"Reconnect\". There is no second sign-in. Your AI workers use the same connection and ask you before recording anything. Outside the office this page shows a different setup-status screen."
  },
  {
    "view": "continuity",
    "title": "Continuity",
    "what": "Shows whether each system has up-to-date backup copies (cloud, own server, emergency server) that were tested by restoring them, and whether emergency playbooks were drilled.",
    "who": "Group leaders and IT. Only IT (or the owner) can add systems and record backups, restore tests and drills; others can only look.",
    "tabs": [
      {
        "name": "Systems and copies",
        "what": "Each system, its recovery targets and each copy's state."
      },
      {
        "name": "Playbooks",
        "what": "Emergency playbooks and their last drill."
      }
    ],
    "tasks": [
      {
        "task": "How to record a backup",
        "steps": [
          "Find the system and the copy.",
          "Press \"Backup done now\"."
        ]
      },
      {
        "task": "How to record a restore test",
        "steps": [
          "Press \"Record restore test\".",
          "Fill in \"Test date\", \"Result\", \"Hours to restore\", \"Minutes of data lost\" and \"Note\".",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to record a drill",
        "steps": [
          "Open \"Playbooks\" and press \"Record a drill\".",
          "Fill in \"Drill date\", \"Actions open\" and \"What was found\".",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to add a system",
        "steps": [
          "Press \"Add system\".",
          "Fill in \"System\", \"What breaks when it is down\", \"Back working within (hours)\", \"Most data we may lose (hours)\" and where each copy is kept.",
          "Press \"Add system\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Restore test",
        "means": "Actually bringing data back from a copy to prove it works."
      },
      {
        "term": "Drill",
        "means": "A practice run of an emergency plan."
      }
    ],
    "notes": "Every entry is test data: Prima is not hosted yet. Recovery targets are proposals. A copy with no record shows as \"Unknown\"; a copy counts only if backed up within target and restore-tested recently."
  },
  {
    "view": "it",
    "title": "IT",
    "what": "Ask IT for help and follow your requests. The IT team also runs jobs, help requests, assets, purchases, websites, joiners and leavers here.",
    "who": "Most staff see only \"Ask IT for help\" and \"My requests\". IT staff, the COO, the CEO, audit, HR and Finance see more tabs for their part. \"Import\" is for the CEO only.",
    "tabs": [
      {
        "name": "My work",
        "what": "IT staff's own jobs."
      },
      {
        "name": "Plan",
        "what": "The week, month and year plan."
      },
      {
        "name": "Jobs",
        "what": "Jobs with due dates, done with proof."
      },
      {
        "name": "Help requests",
        "what": "The help queue with priority and time limit."
      },
      {
        "name": "Team",
        "what": "The IT team and who is away."
      },
      {
        "name": "Systems and access",
        "what": "Systems, access, and access requests."
      },
      {
        "name": "Assets",
        "what": "Register of IT devices, including disposal."
      },
      {
        "name": "Device rental",
        "what": "Device rental billing."
      },
      {
        "name": "Purchases",
        "what": "IT purchases and approvals."
      },
      {
        "name": "Maintenance",
        "what": "Service, repair and disposal."
      },
      {
        "name": "Websites and domains",
        "what": "The websites register."
      },
      {
        "name": "Tenders (eP)",
        "what": "IT part of tenders."
      },
      {
        "name": "Joining and leaving",
        "what": "IT steps for joiners and leavers."
      },
      {
        "name": "My requests",
        "what": "Ask IT and follow your requests."
      }
    ],
    "tasks": [
      {
        "task": "How to ask IT for help",
        "steps": [
          "Press \"Ask IT for help\" (or open \"My requests\").",
          "Choose \"About\" and \"Urgency\" (P1: I cannot work at all, P2: work is slowed down, P3: a question or training).",
          "Fill in \"What is wrong\" and \"Details (optional)\".",
          "Press \"Send to IT\"."
        ]
      },
      {
        "task": "How to confirm IT fixed my problem",
        "steps": [
          "Open \"My requests\".",
          "At \"Is it fixed?\" press \"Yes, it is fixed\", or write what is still wrong and press \"Not fixed\"."
        ]
      },
      {
        "task": "How to handle a help request (IT)",
        "steps": [
          "Open \"Help requests\" (\"Log a request\" for someone who called). Press \"Take it\", fix it, write what fixed it and press \"Resolve\"."
        ]
      },
      {
        "task": "How to ask to buy IT equipment",
        "steps": [
          "Open \"Purchases\" and press \"Ask to buy\".",
          "Fill in \"Why it is needed\", \"For\", \"Kind\", \"Item and model\", \"Quantity\" and \"Unit price, RM\".",
          "Press \"Send for approval\". When the COO or CEO decides, a comment is needed to approve or reject."
        ]
      },
      {
        "task": "How to dispose of a device (IT)",
        "steps": [
          "Open the device in \"Assets\", write a \"Note\" and press \"Ask to dispose\".",
          "The manager fills in \"E-waste contractor\" and \"Consignment note or certificate\" (both needed; wipe the data first) and presses \"Dispose\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "P1 / P2 / P3",
        "means": "How urgent the request is; P1 is most urgent."
      }
    ],
    "notes": "Press \"Workflow guide\" for step-by-step help. During the pilot, people who do not sign in reach IT by Teams, email or phone and IT logs it. The CEO needs a comment to decide an access request or press \"Confirm the recorded list\". Goods delivery for IT purchases is recorded in \"IT purchase fulfilment\"."
  },
  {
    "view": "it-procurement",
    "title": "IT purchase fulfilment",
    "what": "Records the steps after an IT purchase is approved: purchase order, goods received, invoice match and payment reference. It records evidence only; it never pays or emails anyone.",
    "who": "Group leaders and PWVSB officers in IT, Finance and audit see it. Only the Merdeka Finance team and the people already allowed in the workflow can press the action buttons.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to record the next step for a purchase",
        "steps": [
          "Find the purchase under \"Purchases to fulfil\".",
          "Press the step offered to you, such as \"Issue approved purchase order\", \"Record actual goods receipt\", \"Check actual supplier invoice\" or \"Record actual payment reference\".",
          "Fill in the actual references, dates and amount.",
          "Tick the box confirming you reviewed it.",
          "Press \"Save procurement evidence\"."
        ]
      },
      {
        "task": "How to ask for an advance payment",
        "steps": [
          "Press \"Request a separate advance exception\".",
          "Explain why it is needed and the supplier's terms.",
          "Press \"Save procurement evidence\". The COO then the CEO must each decide."
        ]
      },
      {
        "task": "How to see the latest",
        "steps": [
          "Press \"Refresh procurement records\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "PO",
        "means": "Purchase order sent to the supplier."
      },
      {
        "term": "Advance",
        "means": "Paying before the goods arrive; needs its own COO and CEO approval."
      }
    ],
    "notes": "If you see \"Protected procurement storage or authority mapping needs setup\", no action is available yet. If no purchases show, none are visible to your account. A legacy record shows as \"Unverified\". Amounts shown never prove a bank transfer."
  },
  {
    "view": "work-kpi",
    "title": "Work KPIs",
    "what": "A read-only report of how fast work moves and how good it is, by department, for a chosen month.",
    "who": "Only the people who keep KPIs: group leadership, the CEO and COO, the ACT head, HR, department heads, the Operations Director, the OGM and regional managers (own companies) and company managers (own company). Others do not see it in the menu.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to look at another month",
        "steps": [
          "Change the \"Month\" box at the top."
        ]
      },
      {
        "task": "How to read a department",
        "steps": [
          "\"Staff work\" and \"Checking work\" show each step: \"Done\", \"Median time\", \"Target\" and \"On time\".",
          "\"Quality\" shows \"First time right\", \"Returns\", \"Reopened\", \"Proof complete\" and \"Requester confirmed\"."
        ]
      },
      {
        "task": "How to see each person",
        "steps": [
          "Open \"By person\" under the department. People are listed by name, not ranked."
        ]
      },
      {
        "task": "How to see what is left out",
        "steps": [
          "Open \"What is not counted\". It lists work \"Not measured yet\" and work \"Not timed by decision\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Median time",
        "means": "The middle time taken: half the work was faster, half slower."
      },
      {
        "term": "On time",
        "means": "Share of steps done within the target."
      },
      {
        "term": "First time right",
        "means": "Share of work finished without being sent back."
      },
      {
        "term": "Provisional",
        "means": "Targets that may still change."
      }
    ],
    "notes": "Nobody presses start or stop; time is counted from when work reaches each person. Approvals are not timed. \"Unknown\" means it is not measured. A department that says \"No timed work, checking or finished work this month\" simply had nothing counted that month."
  },
  {
    "view": "it-metrics",
    "title": "Workflow time & quality",
    "what": "Lets staff time their own work on a workflow stage (working, waiting, ready for handoff) so the team can see how long work takes. It is not attendance, screen watching or a ranking.",
    "who": "Directors, PWVSB officers, company managers and admin executives (not site or patrol officers). You see only the stages in your own scope. Only the IT Manager can review timing targets.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to start timing a piece of work",
        "steps": [
          "Under \"Stages you can open\" press \"Open prospective timing for this stage\".",
          "Press \"Start recorded work interval\" when you begin."
        ]
      },
      {
        "task": "How to pause or wait",
        "steps": [
          "Press \"Pause to internal queue\" when it waits in the queue, or \"Record external waiting\" when you wait for someone outside.",
          "Press \"Resume recorded work interval\" to carry on."
        ]
      },
      {
        "task": "How to finish",
        "steps": [
          "Press \"Mark ready for handoff\". This does not submit or approve the work itself."
        ]
      },
      {
        "task": "How to see current times",
        "steps": [
          "Press \"Refresh authorized timing snapshot\". Times shown are snapshots, not a live clock."
        ]
      }
    ],
    "terms": [
      {
        "term": "Handoff",
        "means": "Passing the work to the next person."
      },
      {
        "term": "Not instrumented",
        "means": "That workflow cannot be timed yet."
      }
    ],
    "notes": "Timing starts only when you open it; earlier time is unknown. \"Which workflows can be timed today\" shows coverage; many are not covered yet. If storage or setup is missing, no timing action is available. Targets are provisional estimates."
  },
  {
    "view": "staff-directory",
    "title": "Staff directory",
    "what": "A list of office staff and their Microsoft 365 mailboxes, with flags for problems like a personal Outlook or a shared mailbox. It does not give anyone a sign-in.",
    "who": "HR, IT (manager, lead, executive), the Chief of Staff, the Deputy Chief of Staff and the CEO. HR, the Chief of Staff or Deputy load and add people. The Chief of Staff, Deputy or CEO approve a batch, never the person who prepared it.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to find someone",
        "steps": [
          "In \"Everyone listed\", type in \"Find a name, company, unit or mailbox\".",
          "To see only one kind of problem, pick it in the \"Show only\" list."
        ]
      },
      {
        "task": "How to load the staff list from a file (HR)",
        "steps": [
          "In \"Load the staff list\" fill \"Where from: file name and date\".",
          "Choose the CSV file, or paste the rows with the heading row first.",
          "Press \"Preview\" and fix any row shown in red.",
          "Press \"Send\" to send the rows for approval."
        ]
      },
      {
        "task": "How to approve or return a batch",
        "steps": [
          "Under \"Batches\" write \"Your comment (needed)\".",
          "Press \"Approve and add\" or \"Return to HR\"."
        ]
      },
      {
        "task": "How to add one missing person",
        "steps": [
          "In \"Key in someone missing\" fill the group, company or unit, \"Name\", \"Job title\" and \"Mailbox\".",
          "Fill \"Where the details come from (needed)\".",
          "Press \"Add\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Personal Outlook",
        "means": "The person uses a personal account and cannot sign in to Prima until IT gives a work account or guest invite."
      }
    ],
    "notes": "If the module is not ready the page says \"The staff directory is not switched on yet.\" or \"The staff directory is switched on but not yet set up in the database.\" IT sets it up after the CEO approves the release. A batch goes in whole or not at all. People already listed are left out. Personal data: do not copy it out of Prima."
  },
  {
    "view": "hr-it-intake",
    "title": "HR / IT coordination",
    "what": "HR prepares a joining or leaving request for a staff member so IT can get ready. It is intake and review only: no Microsoft account or Prima access is created or removed here.",
    "who": "HR prepares the request. The Chief of Staff (CoS) and the Company Head must each approve the same version. An HR Administrator then reviews the handoff. The IT Lead records technical details. You see only requests your role can see.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to start a joining or leaving request (HR)",
        "steps": [
          "Press \"Prepare HR joining / leaving intake\".",
          "Choose \"Workflow\" (Joining / onboarding or Leaving / offboarding), \"Company scope\" and \"Existing authoritative staff / HR person\".",
          "Choose \"Proposed ordinary role\", the effective date and the reason.",
          "Press \"Save staged operation\".",
          "Then press \"Submit exact scope for review\" and save again."
        ]
      },
      {
        "task": "How to approve a request (CoS or Company Head)",
        "steps": [
          "Open it under \"Coordination requests\".",
          "Press \"CoS review exact scope\" or \"Company Head review exact scope\".",
          "Choose \"Approve exact proposed scope only\" or \"Return with comment\"."
        ]
      },
      {
        "task": "How to cancel a request",
        "steps": [
          "Press \"Cancel coordination request\" and give the reason."
        ]
      }
    ],
    "terms": [
      {
        "term": "CoS",
        "means": "Chief of Staff."
      },
      {
        "term": "Onboarding / offboarding",
        "means": "Setting up a new joiner / closing access for a leaver."
      }
    ],
    "notes": "Never enter passwords, tokens or recovery codes. If you see a notice that storage or the organisation tenant needs setup, those steps stay pending. Urgent access closure for a leaver is handled separately and must not wait for this."
  },
  {
    "view": "websites",
    "title": "Websites",
    "what": "One register of every company's websites, domains and social media, with quarterly content reviews, monthly checks, issues and DNS changes. Nothing is published from here.",
    "who": "IT, group management, and each company's Head of Company, content owner and approver. Company people see their own companies' websites. \"Email\", \"Monthly checks\", \"DNS changes\" and \"Settings\" show only for IT, group management or admins.",
    "tabs": [
      {
        "name": "Overview",
        "what": "Coverage, exceptions and your notices."
      },
      {
        "name": "Companies",
        "what": "Each company's websites and domains."
      },
      {
        "name": "Websites",
        "what": "The website register."
      },
      {
        "name": "Domains",
        "what": "Domains and their expiry."
      },
      {
        "name": "Social media",
        "what": "Company social media accounts."
      },
      {
        "name": "Email",
        "what": "Company email setup."
      },
      {
        "name": "Quarterly reviews",
        "what": "Content reviews with each company."
      },
      {
        "name": "Monthly checks",
        "what": "IT's monthly website checks."
      },
      {
        "name": "Issues",
        "what": "Issues and urgent changes."
      },
      {
        "name": "DNS changes",
        "what": "Changes to domain settings."
      },
      {
        "name": "Reports",
        "what": "Summary reports."
      },
      {
        "name": "Settings",
        "what": "Admin settings."
      }
    ],
    "tasks": [
      {
        "task": "How to answer the quarterly review (company)",
        "steps": [
          "Open \"Quarterly reviews\" and press your website.",
          "Under \"Your answer\" choose the \"Result\".",
          "Tick what you checked (or press \"Tick all\").",
          "If changes are needed, fill in each change; press \"Add another change\" for more.",
          "Press \"Send answer\"."
        ]
      },
      {
        "task": "How to report a website problem",
        "steps": [
          "Open \"Issues\" and press \"Report an issue\".",
          "Fill in \"Company\", \"Website\", \"What kind\", \"How serious\" and \"What is wrong\".",
          "Press \"Report\"."
        ]
      },
      {
        "task": "How to check when a domain expires",
        "steps": [
          "Open \"Domains\" and press the domain."
        ]
      }
    ],
    "terms": [
      {
        "term": "Domain",
        "means": "The web address, for example the part after www."
      },
      {
        "term": "DNS",
        "means": "Settings that point a domain to the website and email."
      }
    ],
    "notes": "Publications and renewals are recorded by hand; notices show inside Prima only (email and Teams not connected). If no websites are assigned to you, the page says so."
  },
  {
    "view": "staffpay",
    "title": "Staff payroll",
    "what": "Monthly salary for office staff (guards and officers are paid separately). You also see your own payslips and set your zakat here.",
    "who": "HR prepares each employer's month, the Chief of Staff approves, then the COO, and Finance pays. Staff with a record see their own payslips. The tabs show only for people with a payroll role.",
    "tabs": [
      {
        "name": "Payroll",
        "what": "Each employer's month, its stage and who acts next."
      },
      {
        "name": "My payslips",
        "what": "Your paid payslips and \"My zakat deduction\"."
      },
      {
        "name": "EPF and SOCSO tables",
        "what": "The contribution tables payroll uses; a second person checks each new one."
      }
    ],
    "tasks": [
      {
        "task": "How to download my payslip",
        "steps": [
          "Open \"My payslips\" and tap a month.",
          "Press \"Download payslip\"."
        ]
      },
      {
        "task": "How to prepare a month (HR)",
        "steps": [
          "Press \"Start a payroll month\", choose \"Employer\" and \"Month\", press \"Prepare the month\".",
          "On lines, type \"PCB from e-PCB\" and press \"Save PCB\"; use \"Add one-off\" or \"Save part-month pay\" if needed.",
          "Press \"Submit to the Chief of Staff\"."
        ]
      },
      {
        "task": "How to approve a month (Chief of Staff or COO)",
        "steps": [
          "Press \"Open and act\".",
          "Type a \"Comment\".",
          "Press \"Approve\" or \"Approve as COO\", or \"Return to HR\" with what must change."
        ]
      },
      {
        "task": "How to mark a month paid (Finance)",
        "steps": [
          "Download files under \"Draft files for Finance\", such as \"Bank upload\".",
          "Type the \"Bank reference\", tick \"PCB checked against LHDN e-PCB for every line\", press \"Mark paid\"."
        ]
      },
      {
        "task": "How to set my zakat",
        "steps": [
          "In \"My zakat deduction\", pick the \"Zakat body\" and percentage, press \"Save my choice\".",
          "To stop, choose \"No zakat deduction\" and press \"Stop my zakat deduction\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "EPF",
        "means": "Retirement savings (KWSP), from you and the employer."
      },
      {
        "term": "SOCSO",
        "means": "PERKESO social security for work injuries."
      },
      {
        "term": "EIS",
        "means": "Employment Insurance for job loss; Malaysians only."
      },
      {
        "term": "PCB",
        "means": "Monthly income tax; \"(estimate)\" until the LHDN e-PCB figure is entered."
      },
      {
        "term": "LINDUNG 24 Jam",
        "means": "SOCSO cover for accidents outside work; can show \"Opted out\"."
      }
    ],
    "notes": "\"No payslips yet\" means Finance has not paid a month for you. Unpaid payslips are drafts. Whoever prepares or submits a month cannot approve it, and a submitted month changes only if returned to HR. Prima only drafts files; Finance uploads them, and only Finance gets \"Bank upload\". Zakat changes apply from the next payroll. HR, Finance and leadership also see \"Pay and salary account changes to verify\"."
  },
  {
    "view": "guardpay",
    "title": "Guard pay",
    "what": "Monthly pay for guards and officers, worked out from locked attendance and the ACT pay formula for each site.",
    "who": "HR prepares each company's month, the COO approves with a reason, and Finance pays. The Director Office lists guards who need cash; the COO or CEO decides. Company managers see their own company. Guards see their payslips on their Duty screen.",
    "tabs": [
      {
        "name": "To check",
        "what": "Inside a month: only the guards whose line has something to check."
      },
      {
        "name": "All",
        "what": "Inside a month: every guard and officer."
      }
    ],
    "tasks": [
      {
        "task": "How to prepare a month (HR)",
        "steps": [
          "Under \"By company\", press \"Prepare\" with the month.",
          "Check lines under \"To check\"; open \"PCB or one-off item\" to type \"PCB from e-PCB\" and press \"Save PCB\".",
          "Press \"Recalculate\" after changes, then \"Submit to the COO\" once the month is over."
        ]
      },
      {
        "task": "How to approve a month (COO)",
        "steps": [
          "Open the month showing \"Your turn\" and read \"Beside the JA Group app\".",
          "Type a \"Reason or comment\", press \"Approve\" or \"Return to HR\"."
        ]
      },
      {
        "task": "How to record payment (Finance)",
        "steps": [
          "Download files such as \"Bank upload\".",
          "Type the bank reference, tick \"PCB checked against LHDN e-PCB for every line\", press \"Mark paid\"."
        ]
      },
      {
        "task": "How to pay a guard in cash",
        "steps": [
          "Director Office: type \"Why this guard needs cash\", press \"List for cash\".",
          "COO or CEO: type a reason, press \"Give cash\" or \"Refuse\", later \"Cash handed out\".",
          "Director Office attaches the signed paper and presses \"Upload signed receipt\"."
        ]
      },
      {
        "task": "How to pay into someone else's account (HR)",
        "steps": [
          "Open \"Whose account, and written consent\" on the guard's line, fill it and press \"Save\".",
          "The COO presses \"Approve letter\" under \"Consent letters waiting for the COO\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Locked attendance",
        "means": "Final attendance for the month; pay is counted from it."
      },
      {
        "term": "Trial",
        "means": "A month worked out only to compare with the JA Group app; nobody is paid from it."
      },
      {
        "term": "Commissioner for Oaths",
        "means": "Pesuruhjaya Sumpah, who stamps a consent letter."
      }
    ],
    "notes": "Prima takes over guard pay on 1 Aug 2027 (Fauzan, 8 Nov 2026). Until then the JA Group app still pays guards, every month is a trial: it cannot be marked paid and its bank file says not to upload it. If the guard pay run is not switched on, nothing can be prepared. Uniform and item deductions are switched off until management and legal decide: Prima refuses a minus one-off item for uniforms or lost or damaged items, equipment is never charged, and advances or loans come back only from approved records on \"Advances and loans\". Every one-off item is flagged for the COO. \"Submit to the COO\" is greyed out until the month ends."
  },
  {
    "view": "advances",
    "title": "Wage advances",
    "what": "Wage advances paid to guards before payday, usually on the 20th, and taken back from that month's pay.",
    "who": "The OM sets advances for one guard or for a whole site, zone or region. The Operations Director (private sites) or the OGM (government sites) approves. Finance pays. HR, Finance and leadership can view.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to set advances (OM)",
        "steps": [
          "Pick the company and month at the top.",
          "In \"Set advances\", choose \"One guard\", \"A site\", \"A zone (branch)\" or \"A region\", then pick which one.",
          "Type \"RM each\", set the pay date and add a reason if you like.",
          "Press \"Set advances\". They wait for the approver."
        ]
      },
      {
        "task": "How to approve advances",
        "steps": [
          "Tick the guards, or press the \"Pick all\" button (it shows how many you can approve).",
          "Type a \"Reason or comment\".",
          "Press \"Approve\"."
        ]
      },
      {
        "task": "How to change or cancel an advance",
        "steps": [
          "Press \"Change or cancel\" on the advance.",
          "Change the amount or pay date and type \"Why it changes\".",
          "Press \"Save change\", or \"Cancel advance\"."
        ]
      },
      {
        "task": "How to see another month",
        "steps": [
          "Change the company list or the month box at the top."
        ]
      }
    ],
    "terms": [
      {
        "term": "OM",
        "means": "Operations Manager."
      },
      {
        "term": "OGM",
        "means": "Operations General Manager, who approves for government sites."
      }
    ],
    "notes": "An advance may not be more than last month's wages. Guards with no bank account or e-wallet, or who already have an advance this month, are skipped. Changing an approved advance needs one more approval. Only the OM sees \"Set advances\". While the JA Group app still pays guards, advances are not paid from Prima; the trial pay run still takes approved advances back so figures can be compared. If the page says advances are not switched on, nothing can be set yet."
  },
  {
    "view": "statutory",
    "title": "Statutory rates",
    "what": "The EPF, SOCSO, EIS, LINDUNG 24 Jam and HRD rates that guard pay and staff payroll use, and any new contribution the law brings.",
    "who": "The CEO changes the rates from a chosen month. HR, Finance, ACT and leadership see what is in force.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to read the rates in force",
        "steps": [
          "The summary card (beside the cards on a computer, at the top on a phone) shows the month, where the rates come from, and each scheme's employee and employer rate at a glance.",
          "Tap a scheme name under the title (EPF, SOCSO, EIS, LINDUNG 24 Jam, HRD levy) to jump to its card.",
          "Each card has a table: who it is for, what the employee pays and what the employer pays. Under it are the wage cap and other facts. On a phone each row is a small card."
        ]
      },
      {
        "task": "How to see past changes",
        "steps": [
          "Tap \"Changes\" under the title, or scroll to the \"Changes\" card.",
          "Each change shows the month it started, whether it is in force, coming or replaced, who set it, why, and the law.",
          "Open \"What changed\" to see each rate before and after."
        ]
      },
      {
        "task": "How to change the rates (CEO)",
        "steps": [
          "Press \"Change rates\".",
          "In \"When it starts\", pick the \"From month\" (last month at the earliest). The boxes start from the rates in force for that month.",
          "Change only the boxes you need in each scheme's step. Under each box you see the rate now; a red line says what to fix.",
          "For a new fund or levy, press \"Add a contribution\" and fill its code, name, rates, who it applies to and \"Paid to\".",
          "Fill \"Law or gazette reference\" and \"Why it changes\", then press \"Review and save\".",
          "Check each rate's now and new value, then press \"Save from\" the month. Press \"Back to edit\" to change something."
        ]
      }
    ],
    "terms": [
      {
        "term": "EPF",
        "means": "Retirement savings (KWSP). Never taken on overtime."
      },
      {
        "term": "SOCSO",
        "means": "PERKESO social security for work injuries."
      },
      {
        "term": "EIS",
        "means": "Employment Insurance for job loss."
      },
      {
        "term": "HRD levy",
        "means": "Training levy paid by the employer to HRD Corp."
      },
      {
        "term": "Wage cap",
        "means": "The pay level above which no more is charged."
      }
    ],
    "notes": "Only the CEO sees \"Change rates\"; the server checks the change again. If the page says it is not switched on, pay uses the law as at November 2026. After a change, any draft pay month should be recalculated. A new change for a month that already has one replaces it, and the old one stays in the history as replaced. PCB comes from LHDN's e-PCB; the minimum wage, day divisor, overtime and public holiday rates are on the Pay formulas screen."
  },
  {
    "view": "arrivalcash",
    "title": "Arrival cash",
    "what": "Cash help for newly arrived foreign workers who are waiting for their PLKS and have no wages yet. FWM asks for each amount, the CEO decides, and the amount is recovered from wages later.",
    "who": "The CEO, Finance and the FWM manager. FWM records the requests and handovers, the CEO approves or refuses each request, and Finance does the finance and legal review.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to ask for arrival cash for a worker (FWM)",
        "steps": [
          "Pick the company at the top of the page.",
          "In \"New arrival request\", choose the \"Worker\" and the \"Site\".",
          "Fill in \"Actual arrival date\", \"FWM recovery months\", \"Unique request reference\", \"Amount (RM)\" and \"Purpose\".",
          "Tick the box that says you checked recent arrival, awaiting PLKS and no wages.",
          "Press \"Submit request\". Finance can see it, but nothing is owed yet."
        ]
      },
      {
        "task": "How to decide a request (CEO)",
        "steps": [
          "Open the worker's card and find the request that says \"Awaiting CEO decision\".",
          "Write the \"Decision reason\".",
          "Press \"Approve\" or refuse it."
        ]
      },
      {
        "task": "How to record that the cash was handed over (FWM)",
        "steps": [
          "On an approved request, fill in \"Actual handover date\" and \"Payment reference\".",
          "Attach the evidence in \"Evidence (genuine receipt or review)\" and tick that you verified it for this exact transaction.",
          "Save the handover. Only a real handover makes an amount owed."
        ]
      },
      {
        "task": "How to attach the signed receipt later",
        "steps": [
          "Find the request that says the receipt is pending.",
          "Choose the scan or photo in \"Evidence (genuine receipt or review)\" and tick the check box.",
          "Press the button to attach the genuine signed receipt. Recovery from wages stays on hold until it is attached."
        ]
      },
      {
        "task": "How Finance records the review (Finance)",
        "steps": [
          "Open the worker's card where \"Finance/legal review\" is shown.",
          "Fill in \"Reviewed cap percentage\", \"Effective month\" and the expiry month, and attach the review evidence.",
          "Save. The card then shows \"Review recorded\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "PLKS",
        "means": "The foreign worker's work permit (Pas Lawatan Kerja Sementara)."
      },
      {
        "term": "Recovery months",
        "means": "How many wage months the amount is taken back over, starting in the first wage month."
      },
      {
        "term": "Reviewed cap",
        "means": "The most that may be taken from one month's wages, as Finance and legal reviewed it."
      }
    ],
    "notes": "Only the CEO, Finance and the FWM manager see this page. A request is only a request: nothing is owed until the cash is really handed over. A missing signed receipt keeps the amount pending and holds recovery. No bank account is needed. The handover button stays off until the Finance/legal review is recorded. Other guard cash help (\"Exceptional guard cash\") is on the Director Office and Finance pages."
  },
  {
    "view": "loans",
    "title": "Advances and loans",
    "what": "The advance and loan scheme for guards. Each has a limit, a purpose, a repayment period and the worker's signed agreement. The wage advance on the 20th is on its own screen.",
    "who": "HR records each one. The Chief of Staff approves, then the CEO. Finance is told at each step, pays it out and watches what is owed. Leadership can view.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to record an advance or loan (HR)",
        "steps": [
          "Pick the company at the top.",
          "In \"Record an advance or loan\", choose the guard and \"Loan\" or \"Advance\".",
          "Fill \"Limit RM\", \"Lent RM (= limit)\", \"Purpose\", \"Months\", the first repayment month, \"Signed agreement ref.\" and the date the worker signed.",
          "Press \"Record\". It goes to the Chief of Staff."
        ]
      },
      {
        "task": "How to approve (Chief of Staff, then CEO)",
        "steps": [
          "Find the record under \"Records\".",
          "Type a \"Reason or comment\".",
          "Press \"Approve\" or \"Reject\"."
        ]
      },
      {
        "task": "How to pay it out (Finance)",
        "steps": [
          "Type the \"Bank reference\" on the approved record.",
          "Press \"Paid out\"."
        ]
      },
      {
        "task": "How to cancel a record",
        "steps": [
          "Type \"Why cancel\".",
          "Press \"Cancel record\"."
        ]
      },
      {
        "task": "How to see what is still owed",
        "steps": [
          "Look at the boxes \"Being repaid\", \"Lent (open)\" and \"Still owed\".",
          "Each record shows the monthly amount, what is repaid and what is owed."
        ]
      }
    ],
    "terms": [
      {
        "term": "Limit",
        "means": "The most that can be lent on this record."
      },
      {
        "term": "Settled",
        "means": "Fully repaid."
      }
    ],
    "notes": "Repayments come off guard pay only from these approved records, and all deductions together stay within half the month's wages. Money goes only to the guard's own bank account or e-wallet. Only HR sees the record form. While the JA Group app still pays guards, records can be made and approved, but Finance pays them out from Prima only after the switch date. If the page says it is not switched on, nothing can be recorded. Uniform and item deductions are not done here; they are switched off."
  },
  {
    "view": "memos",
    "title": "Memos",
    "what": "Official memos to staff or to guards and officers. Open each memo and confirm you have read it.",
    "who": "Everyone reads the memos meant for them. Only the Chief of Staff publishes to all staff, and only the COO publishes to all guards and officers. The publisher sees who has read each memo.",
    "tabs": [],
    "tasks": [
      {
        "task": "How to read a memo",
        "steps": [
          "Press \"Not read\" to see memos waiting for you.",
          "Tap the memo to open it.",
          "Press \"I have read this\"."
        ]
      },
      {
        "task": "How to find a memo",
        "steps": [
          "Type in \"Search memos\", or press \"All\"."
        ]
      },
      {
        "task": "How to publish a memo (Chief of Staff or COO)",
        "steps": [
          "Press \"New memo\".",
          "Choose \"To\" if asked, then fill \"Title\" and \"Memo\".",
          "Tick states to limit who sees it, or leave none for everywhere.",
          "Press \"Publish\"."
        ]
      }
    ],
    "terms": [],
    "notes": "A warning at the top shows how many memos you have not read. A memo can be limited to some states, such as Penang. \"New memo\" shows only for the Chief of Staff and the COO. The title needs at least 3 characters."
  },
  {
    "view": "handovers",
    "title": "Hand-overs",
    "what": "Key it once: when one department records something another needs, the right people get a hand-over here with a link to the record.",
    "who": "Office staff and managers see hand-overs sent to their desk. ACT and group leadership also see late links on the department map.",
    "tabs": [
      {
        "name": "My hand-overs",
        "what": "What other departments sent you to do or know."
      },
      {
        "name": "Guide",
        "what": "Step guides for the tasks you are allowed to do."
      },
      {
        "name": "How departments connect",
        "what": "Every link between departments and who is told."
      },
      {
        "name": "Import existing records",
        "what": "Load existing records from a CSV spreadsheet."
      }
    ],
    "tasks": [
      {
        "task": "How to act on a hand-over",
        "steps": [
          "Open \"My hand-overs\".",
          "Press \"Open this record in\" the screen shown (or \"Open\" the screen) to see it.",
          "For a to-do, type \"What was done\" and press \"Done\" or \"Not needed\". For information, press \"Noted\"."
        ]
      },
      {
        "task": "How to see older hand-overs",
        "steps": [
          "Tick \"Show closed\".",
          "Press \"Show more\" at the bottom."
        ]
      },
      {
        "task": "How to import existing records",
        "steps": [
          "Open \"Import existing records\" and choose the \"Kind\" (and \"Company\" if asked).",
          "Choose the \"CSV file\" or paste it.",
          "Press \"Check the file\" and fix any \"Rows to fix\".",
          "Press \"Import\" with the row count."
        ]
      }
    ],
    "terms": [
      {
        "term": "Hand-over",
        "means": "A note from another department with a link to their record. It never approves, pays or changes their records."
      },
      {
        "term": "CSV",
        "means": "A spreadsheet saved as plain text with column names in the first row."
      }
    ],
    "notes": "In-app only: email and Teams notices stay off for now. If it says hand-overs are switched off, other departments are not told automatically yet. If a record is on a screen not in your menu, ask the sender. An import is all rows or none, the same file cannot be imported twice, and imported records do not send hand-overs."
  },
  {
    "view": "registers",
    "title": "Governance registers",
    "what": "Simple registers a well-run group keeps: related-party deals, directors' interests, board committees and risks. You see only the registers that are yours. Prima records and reminds; it never approves for the board.",
    "who": "Deals and directors' interests: the Deputy Chief of Staff records, the Chief of Staff reviews, the CEO sees. Committees: company managers and admin executives keep their own company's; the Chief of Staff and Deputy keep PWVSB's; legal and group leaders watch. Risks: ACT only, run by the ACT Director; the CEO sees.",
    "tabs": [
      {
        "name": "Related-party deals",
        "what": "Deals with directors, shareholders or related companies."
      },
      {
        "name": "Directors' interests",
        "what": "Each director's signed declaration."
      },
      {
        "name": "Committees",
        "what": "Board committees, members and meetings."
      },
      {
        "name": "Risks",
        "what": "The risk register with scores and actions."
      }
    ],
    "tasks": [
      {
        "task": "How to record a related-party deal",
        "steps": [
          "Open \"Related-party deals\" and press \"Record a deal\".",
          "Fill the other party, how they are related, the kind of deal, total value, dates and why the price is fair.",
          "Press \"Save\". The Chief of Staff then presses \"Price is fair\" or \"Ask a question\"."
        ]
      },
      {
        "task": "How to record a director's declaration",
        "steps": [
          "Open \"Directors' interests\" and press \"Record a declaration\".",
          "Fill the director's name, date and form reference.",
          "Add each interest (\"Add another interest\") or tick \"Nothing to declare\".",
          "Press \"Save\"."
        ]
      },
      {
        "task": "How to record a committee meeting",
        "steps": [
          "Open \"Committees\". Press \"Add a committee\" if it is not listed.",
          "On the committee press \"Record a meeting\".",
          "Fill the date, members present and minutes reference, then press \"Save\"."
        ]
      },
      {
        "task": "How to add or review a risk (ACT)",
        "steps": [
          "Open \"Risks\" and press \"Add a risk\".",
          "Fill what could go wrong, the owner, \"Likelihood\", \"Impact\" and what is already in place.",
          "Press \"Save\". Later use \"Review\", \"Give to the team\" or \"Settle and close\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Unknown",
        "means": "No declaration or meeting on file. It is never shown as clear."
      }
    ],
    "notes": "If the module is not installed, the page shows \"Governance registers are not switched on yet. The database part waits for the CEO to approve it.\" Tabs you do not see are not yours. The page shows test data."
  },
  {
    "view": "quality",
    "title": "Quality and compliance",
    "what": "One list of what ISO 9001 and the PIKM code ask for, with the Prima records that prove it, plus faults, suppliers, objectives, documents, review and staff skills. A person checks the evidence; Prima never says a company is compliant.",
    "who": "ACT keeps the requirements list. Company managers link evidence and record faults. HR keeps role profiles. Managers and officers assess staff. Supervisors see it as \"Guard skills\". Procurement (not storekeepers) sees \"Supplier ratings\". The CEO agrees key records.",
    "tabs": [
      {
        "name": "Requirements register",
        "what": "Each requirement with its evidence."
      },
      {
        "name": "Service faults",
        "what": "Times the service was not what was agreed."
      },
      {
        "name": "Supplier ratings",
        "what": "Supplier ratings, at least yearly."
      },
      {
        "name": "Objectives",
        "what": "Yearly quality targets."
      },
      {
        "name": "Documents",
        "what": "Procedures and forms in force."
      },
      {
        "name": "Management review",
        "what": "The review record the CEO agrees."
      },
      {
        "name": "QMS foundation",
        "what": "Scope, policy and main processes."
      },
      {
        "name": "Competency matrix",
        "what": "What each role needs and assessments."
      }
    ],
    "tasks": [
      {
        "task": "How to link evidence (company manager)",
        "steps": [
          "Open \"Requirements register\" and press \"Open\" on a requirement.",
          "Choose the kind of evidence, fill \"What it is\" and the reference.",
          "Press \"Link evidence\". ACT then presses \"Evidence is right\" or \"Not accepted\"."
        ]
      },
      {
        "task": "How to record a service fault",
        "steps": [
          "Open \"Service faults\" and press \"Record a fault\".",
          "Fill what happened, what was done at once and the date found.",
          "Press \"Record\". Later press \"Close\" and then \"Close the fault\"."
        ]
      },
      {
        "task": "How to rate a supplier",
        "steps": [
          "Press \"Rate\" on the supplier.",
          "Score quality, time and paperwork from 1 to 5 and pick the result.",
          "Press \"Save the rating\"."
        ]
      },
      {
        "task": "How to assess a guard",
        "steps": [
          "In the people list press \"Open\".",
          "Choose what you assessed, \"Competent\" or \"Not yet competent\", and how.",
          "Write what you saw and press \"Save assessment\"."
        ]
      }
    ],
    "terms": [
      {
        "term": "Stop",
        "means": "A supplier rating that blocks the supplier; only Finance can unblock it."
      }
    ],
    "notes": "If the module is not installed, the page shows \"Quality and compliance is not switched on yet. The database part waits for the CEO to approve it.\" Storekeepers and admin executives do not see it. Tabs you do not see are not for your role. The page shows test data."
  }
];
