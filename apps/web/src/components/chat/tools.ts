/** What each tool looks like under a chat reply: a friendly label and an icon. Covers the
 * assistants' tools and the common agent tools; anything else shows its name in plain words. */
import {
  BookOpenTextIcon, BrainIcon, BrowserIcon, CalculatorIcon, CalendarBlankIcon, CalendarCheckIcon, CalendarPlusIcon, CalendarXIcon,
  ChartLineUpIcon, ClipboardTextIcon, ClockCountdownIcon, ClockIcon, CodeIcon, CursorClickIcon, EnvelopeSimpleIcon, FileTextIcon,
  FilesIcon, FloppyDiskIcon, FlowArrowIcon, GlobeIcon, HandIcon, ImageIcon, KanbanIcon, LightbulbIcon, LightningIcon,
  MagnifyingGlassIcon, NotePencilIcon, PaperPlaneRightIcon, SparkleIcon, TrendDownIcon, UsersThreeIcon, WhatsappLogoIcon,
  type Icon,
} from "@phosphor-icons/react";

import { msg } from "@/i18n";

export interface ToolLook { label: string; icon: Icon }

export const TOOL_LOOK: Record<string, ToolLook> = {
  // assistants
  company_pulse: { label: msg("Company pulse"), icon: ChartLineUpIcon },
  team_performance: { label: msg("Team performance"), icon: UsersThreeIcon },
  slacking_report: { label: msg("Where things slip"), icon: TrendDownIcon },
  notify_person: { label: msg("Messaged a person"), icon: WhatsappLogoIcon },
  message_agent: { label: msg("Gave an agent a job"), icon: LightningIcon },
  email_search: { label: msg("Searched email"), icon: MagnifyingGlassIcon },
  email_read: { label: msg("Read an email"), icon: EnvelopeSimpleIcon },
  email_draft_reply: { label: msg("Drafted a reply"), icon: PaperPlaneRightIcon },
  email_draft: { label: msg("Drafted an email"), icon: PaperPlaneRightIcon },
  calendar_agenda: { label: msg("Read your calendar"), icon: CalendarBlankIcon },
  calendar_free_slots: { label: msg("Found free time"), icon: CalendarCheckIcon },
  calendar_create_event: { label: msg("Proposed an event"), icon: CalendarPlusIcon },
  calendar_update_event: { label: msg("Proposed a change"), icon: CalendarBlankIcon },
  calendar_cancel_event: { label: msg("Proposed a cancellation"), icon: CalendarXIcon },
  schedule_task: { label: msg("Set up a schedule"), icon: ClockCountdownIcon },
  list_my_schedules: { label: msg("Checked schedules"), icon: ClockCountdownIcon },
  cancel_schedule: { label: msg("Cancelled a schedule"), icon: ClockCountdownIcon },
  // research and the web
  web_search: { label: msg("Searched the web"), icon: GlobeIcon },
  web_fetch: { label: msg("Read a web page"), icon: GlobeIcon },
  research_gather: { label: msg("Researched"), icon: MagnifyingGlassIcon },
  publish_research: { label: msg("Wrote up research"), icon: FileTextIcon },
  // memory and knowledge
  recall: { label: msg("Checked its memory"), icon: BrainIcon },
  remember: { label: msg("Remembered this"), icon: BrainIcon },
  search_library: { label: msg("Searched the library"), icon: BookOpenTextIcon },
  find_sop: { label: msg("Looked up an SOP"), icon: BookOpenTextIcon },
  read_page: { label: msg("Read a wiki page"), icon: BookOpenTextIcon },
  write_page: { label: msg("Updated the wiki"), icon: NotePencilIcon },
  team_directory: { label: msg("Checked the team"), icon: UsersThreeIcon },
  ask_colleague: { label: msg("Asked a colleague"), icon: UsersThreeIcon },
  ask_human: { label: msg("Asked a person"), icon: HandIcon },
  // tasks
  create_task: { label: msg("Created a task"), icon: KanbanIcon },
  delegate: { label: msg("Handed off work"), icon: FlowArrowIcon },
  update_plan: { label: msg("Updated its plan"), icon: ClipboardTextIcon },
  report_progress: { label: msg("Reported progress"), icon: ClipboardTextIcon },
  // documents and files
  search_documents: { label: msg("Searched documents"), icon: MagnifyingGlassIcon },
  company_documents: { label: msg("Checked company documents"), icon: FilesIcon },
  draft_document: { label: msg("Drafted a document"), icon: FileTextIcon },
  revise_document: { label: msg("Revised a document"), icon: NotePencilIcon },
  check_document: { label: msg("Checked a document"), icon: FileTextIcon },
  export_document: { label: msg("Exported a document"), icon: FloppyDiskIcon },
  list_templates: { label: msg("Looked at templates"), icon: FilesIcon },
  list_files: { label: msg("Looked at files"), icon: FilesIcon },
  read_file: { label: msg("Read a file"), icon: FileTextIcon },
  rename_file: { label: msg("Renamed a file"), icon: NotePencilIcon },
  publish_report: { label: msg("Published a report"), icon: FileTextIcon },
  view_image: { label: msg("Looked at an image"), icon: ImageIcon },
  generate_image: { label: msg("Made an image"), icon: ImageIcon },
  // the browser
  browser_open: { label: msg("Opened a website"), icon: BrowserIcon },
  browser_read: { label: msg("Read a website"), icon: BrowserIcon },
  browser_snapshot: { label: msg("Read a website"), icon: BrowserIcon },
  browser_find: { label: msg("Searched a website"), icon: BrowserIcon },
  browser_click: { label: msg("Used a website"), icon: CursorClickIcon },
  browser_type: { label: msg("Used a website"), icon: CursorClickIcon },
  browser_fill: { label: msg("Filled in a form"), icon: CursorClickIcon },
  browser_select: { label: msg("Used a website"), icon: CursorClickIcon },
  browser_submit: { label: msg("Submitted a form"), icon: CursorClickIcon },
  browser_upload: { label: msg("Uploaded a file"), icon: CursorClickIcon },
  browser_save_page: { label: msg("Saved a web page"), icon: FloppyDiskIcon },
  // other
  calc: { label: msg("Calculated"), icon: CalculatorIcon },
  finance_calc: { label: msg("Calculated"), icon: CalculatorIcon },
  run_python: { label: msg("Ran code"), icon: CodeIcon },
  time_now: { label: msg("Checked the time"), icon: ClockIcon },
  think: { label: msg("Thought it through"), icon: LightbulbIcon },
  use_skill: { label: msg("Used a skill"), icon: SparkleIcon },
};

/** Tools that hand work to the board: their chip links to the task. */
export const TASK_TOOLS = ["create_task", "message_agent"];

/** Any browser_* tool not listed above still reads as "Used a website". */
export function toolLook(name: string): ToolLook | undefined {
  return TOOL_LOOK[name] ?? (name.startsWith("browser_") ? { label: msg("Used a website"), icon: BrowserIcon } : undefined);
}
