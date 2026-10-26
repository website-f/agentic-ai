/** P50 CRM icon names (stored on objects, templates and presets) to Phosphor icons. Unknown
 * names fall back to a cube, so the owner can type any short name without breaking the page. */
import {
  AddressBookIcon, BriefcaseIcon, CalendarCheckIcon, CalendarDotsIcon, ChalkboardTeacherIcon, ConfettiIcon, CreditCardIcon, CubeIcon,
  EnvelopeIcon, FileCsvIcon, FilesIcon, FirstAidIcon, FolderOpenIcon, HandshakeIcon, HardHatIcon, HouseIcon, IdentificationCardIcon,
  KanbanIcon, LifebuoyIcon, MegaphoneIcon, PackageIcon, PlugsConnectedIcon, ReceiptIcon, ReceiptXIcon, RepeatIcon, RobotIcon,
  ShoppingCartIcon, StorefrontIcon, StudentIcon, TableIcon, TruckIcon, UsersIcon, UsersThreeIcon, WebhooksLogoIcon, type Icon,
} from "@phosphor-icons/react";

export const CRM_ICONS: Record<string, Icon> = {
  "address-book": AddressBookIcon, briefcase: BriefcaseIcon, "calendar-check": CalendarCheckIcon, "calendar-dots": CalendarDotsIcon,
  "chalkboard-teacher": ChalkboardTeacherIcon, confetti: ConfettiIcon, "credit-card": CreditCardIcon, cube: CubeIcon, envelope: EnvelopeIcon,
  "file-csv": FileCsvIcon, files: FilesIcon, "first-aid": FirstAidIcon, "folder-open": FolderOpenIcon, handshake: HandshakeIcon,
  "hard-hat": HardHatIcon, house: HouseIcon, "identification-card": IdentificationCardIcon, kanban: KanbanIcon, lifebuoy: LifebuoyIcon,
  megaphone: MegaphoneIcon, package: PackageIcon, "plugs-connected": PlugsConnectedIcon, receipt: ReceiptIcon, "receipt-x": ReceiptXIcon,
  repeat: RepeatIcon, robot: RobotIcon, "shopping-cart": ShoppingCartIcon, storefront: StorefrontIcon, student: StudentIcon, table: TableIcon,
  truck: TruckIcon, users: UsersIcon, "users-three": UsersThreeIcon, "webhooks-logo": WebhooksLogoIcon,
};

/** Icons the owner can pick for a new list (a short, friendly set). */
export const PICKABLE = [
  "cube", "briefcase", "kanban", "users-three", "address-book", "handshake", "storefront", "shopping-cart", "package", "truck",
  "house", "student", "first-aid", "hard-hat", "calendar-check", "confetti", "lifebuoy", "receipt", "files", "megaphone",
];

export const crmIcon = (name: string | null | undefined): Icon => CRM_ICONS[name ?? ""] ?? CubeIcon;
