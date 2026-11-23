/**
 * P71 (Agentic Office): one icon per screen, from the office's own icon set (Phosphor), so the menu reads at a glance
 * and Prima looks like the rest of the office. Unknown screens fall back to the old line icon.
 */
import {
  AddressBookIcon, ArrowsLeftRightIcon, BankIcon, BedIcon, BriefcaseIcon, BuildingOfficeIcon, BuildingsIcon,
  CalendarDotsIcon, CarIcon, CertificateIcon, ChartBarIcon, ChartLineUpIcon, ChatsCircleIcon, ClockIcon,
  CompassIcon, CreditCardIcon, CrosshairIcon, DesktopTowerIcon, DeviceMobileIcon, FileTextIcon, FingerprintIcon,
  FirstAidKitIcon, GavelIcon, GitBranchIcon, GlobeHemisphereEastIcon, GlobeIcon, HandshakeIcon, HouseIcon,
  IdentificationBadgeIcon, KanbanIcon, LifebuoyIcon, ListMagnifyingGlassIcon, LockKeyIcon, MapPinIcon,
  MapTrifoldIcon, MegaphoneIcon, MoneyIcon, MonitorPlayIcon, NoteIcon, PackageIcon, PlugsConnectedIcon,
  ReceiptIcon, ScalesIcon, ShoppingCartIcon, SparkleIcon, StampIcon, StorefrontIcon, TimerIcon, TrayIcon,
  TruckIcon, UmbrellaIcon, UserIcon, UserSwitchIcon, UsersThreeIcon, WalletIcon, WarningOctagonIcon,
  ArrowClockwiseIcon, HandArrowDownIcon, BookOpenTextIcon, ClipboardTextIcon, type Icon as PhosphorIcon,
  // P128: every menu screen has its own icon (the quick-app pills on the home screen showed a bare line icon at full size).
  CalendarCheckIcon, BroomIcon, ShieldCheckIcon, WarehouseIcon, CheckSquareOffsetIcon, CoinsIcon, ChartPieIcon, SwapIcon,
  HandCoinsIcon, CurrencyCircleDollarIcon, ScrollIcon, CashRegisterIcon, PiggyBankIcon, TargetIcon, IdentificationCardIcon,
  UserGearIcon, BarcodeIcon, BooksIcon, FunctionIcon, ClockCountdownIcon, CalculatorIcon, ListChecksIcon, MedalIcon,
  SealCheckIcon, HandHeartIcon, MegaphoneSimpleIcon, TreeStructureIcon, KeyIcon, MagicWandIcon, ArchiveIcon, EraserIcon,
} from '@phosphor-icons/react';
import { Icon } from './ui';

const BY_VIEW: Record<string, PhosphorIcon> = {
  home: HouseIcon,
  // P121
  sop: BookOpenTextIcon,
  equiprequests: ClipboardTextIcon,
  overview: BuildingsIcon,
  company: StorefrontIcon,
  office: BuildingOfficeIcon,
  sites: MapPinIcon,
  roster: CalendarDotsIcon,
  people: UsersThreeIcon,
  attendance: ClockIcon,
  cases: WarningOctagonIcon,
  compliance: CertificateIcon,
  commercial: HandshakeIcon,
  ops: CompassIcon,
  hr: IdentificationBadgeIcon,
  insurance: UmbrellaIcon,
  arms: CrosshairIcon,
  cms: MonitorPlayIcon,
  audit: ListMagnifyingGlassIcon,
  device: DeviceMobileIcon,
  doa: BriefcaseIcon,
  reports: ChartBarIcon,
  meetings: ChatsCircleIcon,
  mine: UserIcon,
  clock: FingerprintIcon,
  staffclock: TimerIcon,
  work: KanbanIcon,
  branchwork: MapTrifoldIcon,
  fwm: GlobeHemisphereEastIcon,
  socso: FirstAidKitIcon,
  hostels: BedIcon,
  claims: ReceiptIcon,
  pdpa: LockKeyIcon,
  clients: AddressBookIcon,
  requests: TrayIcon,
  payreq: WalletIcon,
  fleet: CarIcon,
  ja: ArrowsLeftRightIcon,
  assets: PackageIcon,
  contracts: FileTextIcon,
  branches: GitBranchIcon,
  finance: BankIcon,
  credit: CreditCardIcon,
  grc: MegaphoneIcon,
  act: ScalesIcon,
  handovers: HandArrowDownIcon,
  governance: GavelIcon,
  corporate: StampIcon,
  renewals: ArrowClockwiseIcon,
  purchasing: ShoppingCartIcon,
  'it-extraction': SparkleIcon,
  connections: PlugsConnectedIcon,
  continuity: LifebuoyIcon,
  it: DesktopTowerIcon,
  'it-procurement': TruckIcon,
  'it-metrics': ChartLineUpIcon,
  'hr-it-intake': UserSwitchIcon,
  websites: GlobeIcon,
  staffpay: MoneyIcon,
  memos: NoteIcon,
  // P128
  guardroster: CalendarCheckIcon,
  cleaning: BroomIcon,
  duty: ShieldCheckIcon,
  sitestock: WarehouseIcon,
  cmsready: CheckSquareOffsetIcon,
  fwcost: CoinsIcon,
  fwstat: ChartPieIcon,
  jaswitch: SwapIcon,
  guardpay: HandCoinsIcon,
  advances: CurrencyCircleDollarIcon,
  statutory: ScrollIcon,
  arrivalcash: CashRegisterIcon,
  loans: PiggyBankIcon,
  'work-kpi': TargetIcon,
  'staff-directory': IdentificationCardIcon,
  accounts: UserGearIcon,
  items: BarcodeIcon,
  registers: BooksIcon,
  payformulas: FunctionIcon,
  sitehours: ClockCountdownIcon,
  salarycalc: CalculatorIcon,
  surveys: ListChecksIcon,
  quality: MedalIcon,
  selfaudit: SealCheckIcon,
  rba: HandHeartIcon,
  marketing: MegaphoneSimpleIcon,
  orgchart: TreeStructureIcon,
  'shared-logins': KeyIcon,
  assistant: MagicWandIcon,
  archive: ArchiveIcon,
  'data-cleanup': EraserIcon,
};

/** The icon of a screen (its view name); the screen's own line icon when there is none. */
export function ViewIcon({ view, fallback, size = 18 }: { view: string; fallback?: string; size?: number }) {
  const I = BY_VIEW[view];
  if (I) return <I size={size} weight="regular" aria-hidden="true" />;
  // P128: the old line icon has no size of its own; it is held to the same size as the others.
  return (
    <span className="view-icon-line" aria-hidden="true" style={{ display: 'inline-grid', width: size, height: size, flex: 'none' }}>
      <Icon name={fallback ?? 'group'} />
    </span>
  );
}
