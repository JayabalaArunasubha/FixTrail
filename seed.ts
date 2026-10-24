import { DEFAULT_TEAM, SLA_HOURS, TRIAGE_SLA_HOURS, type Activity, type Category, type Issue, type Priority, type Status, type Viewer } from "./domain";

export const DEMO_USERS: Record<"staff" | "reporter", Viewer> = {
  staff: { id: "demo-staff", name: "Jordan Reyes", role: "staff" },
  reporter: { id: "demo-reporter", name: "Priya Nair", role: "reporter" },
};

interface SeedRow {
  title: string;
  description: string;
  building: string;
  location: string;
  category: Category;
  priority: Priority | null;
  status: Status;
  hoursAgo: number;
  reporter: [string, string];
  assignedTo?: string;
  resolvedHoursAgo?: number;
  resolution?: string;
}

const PRIYA: [string, string] = ["demo-reporter", "Priya Nair"];

// Illustrative records. They carry human decisions but no Gemma assessments: we never fabricate model output.
const ROWS: SeedRow[] = [
  { title: "Water dripping from ceiling in 2nd floor bathroom", description: "Steady drip from a ceiling tile above the second sink in the women's bathroom. Tile is stained brown and sagging slightly. Put a bin under it.", building: "Maple Hall", location: "Room 214 bathroom", category: "plumbing", priority: "high", status: "in_progress", hoursAgo: 30, reporter: PRIYA, assignedTo: "Luis Ortega" },
  { title: "Ceiling leak again near room 214", description: "The ceiling in the 214 bathroom is leaking again, same tile as last month. Water pooling on the floor by the sinks.", building: "Maple Hall", location: "Rm 214 bathroom", category: "plumbing", priority: "high", status: "resolved", hoursAgo: 24 * 26, reporter: ["s-amir", "Amir Haddad"], assignedTo: "Luis Ortega", resolvedHoursAgo: 24 * 25, resolution: "Re-sealed drain gasket on 3rd floor sink above. Replaced stained ceiling tile." },
  { title: "Leak under sink, room 214", description: "Small puddle forming under the sink cabinet in the 214 bathroom. Cabinet base is wet and soft.", building: "Maple Hall", location: "214 Bathroom", category: "plumbing", priority: "medium", status: "resolved", hoursAgo: 24 * 48, reporter: ["s-mei", "Mei Chen"], assignedTo: "Luis Ortega", resolvedHoursAgo: 24 * 47, resolution: "Tightened slip nut on P-trap. No further leak observed after 30 minutes of running water." },
  { title: "Wi‑Fi drops every few minutes on library 2nd floor", description: "Laptops keep disconnecting from campus Wi‑Fi on the second floor study area near the windows. Reconnects after a minute then drops again. Several students noticed it.", building: "Hartley Library", location: "2nd floor study area", category: "networking", priority: "medium", status: "triaged", hoursAgo: 52, reporter: ["s-dev", "Dev Patel"] },
  { title: "Wifi keeps disconnecting in library study zone", description: "Constant wifi disconnects on 2nd floor of library, near group study rooms. Zoom calls dropping.", building: "Hartley Library", location: "Second floor study area", category: "networking", priority: "medium", status: "resolved", hoursAgo: 24 * 12, reporter: PRIYA, assignedTo: "Sam Whitaker", resolvedHoursAgo: 24 * 11, resolution: "Rebooted access point AP-2F-03. Monitoring for recurrence." },
  { title: "Exposed wires behind panel in Lab 3", description: "A cover plate behind bench 4 in Lab 3 has come off and there are exposed wires visible. Students are working at the bench nearby. We taped off the area.", building: "Engineering Building", location: "Lab 3, bench 4", category: "electrical", priority: "critical", status: "in_progress", hoursAgo: 6, reporter: ["s-ana", "Dr. Ana Souza"], assignedTo: "Kwame Mensah" },
  { title: "Projector won't turn on in lecture hall B", description: "The ceiling projector in Lecture Hall B shows no power light. Tried the wall control panel and the remote. Class at 9am tomorrow needs it.", building: "Science Center", location: "Lecture Hall B", category: "equipment", priority: "medium", status: "triaged", hoursAgo: 80, reporter: ["s-tom", "Tom Becker"] },
  { title: "Elevator doors closing very slowly", description: "Elevator 2 doors take a long time to close and sometimes reopen on their own. Still running.", building: "Riverside Apartments", location: "Elevator 2, lobby", category: "equipment", priority: "high", status: "triaged", hoursAgo: 40, reporter: ["s-grace", "Grace Kim"], assignedTo: "Facilities on-call" },
  { title: "Overflowing trash room on floor 3", description: "Trash chute room on floor 3 is overflowing and smells. Bags piled on the floor.", building: "Riverside Apartments", location: "Floor 3 trash room", category: "cleaning", priority: "low", status: "resolved", hoursAgo: 24 * 4, reporter: ["s-omar", "Omar Farouk"], assignedTo: "Custodial team B", resolvedHoursAgo: 24 * 3.5, resolution: "Cleared bags and cleaned room. Chute was blocked at floor 2; cleared." },
  { title: "Crack in stairwell wall getting wider", description: "There is a crack running diagonally on the east stairwell wall between floors 1 and 2. It looks longer than it was two weeks ago, maybe 40cm now.", building: "Maple Hall", location: "East stairwell, floor 1–2", category: "structural", priority: null, status: "new", hoursAgo: 3, reporter: PRIYA },
  { title: "Radiator not heating in apartment 5C", description: "Radiator in the bedroom of 5C is cold even with the valve fully open. Living room radiator works.", building: "Riverside Apartments", location: "Apartment 5C bedroom", category: "plumbing", priority: null, status: "new", hoursAgo: 28, reporter: ["s-lena", "Lena Fischer"] },
  { title: "Broken chair in seminar room", description: "One of the chairs in Seminar Room 1 has a cracked leg and wobbles. Moved it to the corner.", building: "Hartley Library", location: "Seminar Room 1", category: "equipment", priority: "low", status: "triaged", hoursAgo: 24 * 9, reporter: ["s-dev", "Dev Patel"] },
];

const iso = (base: Date, hoursAgo: number) => new Date(base.getTime() - hoursAgo * 3_600_000).toISOString();

export function seedDemoData(base: Date) {
  const issues: (Issue & { clientRequestId?: string })[] = [];
  const activity: Activity[] = [];
  const sampleStaff = { actorId: "sample-staff", actorName: "Sample staff" };

  ROWS.forEach((r, n) => {
    const id = `sample-${String(n + 1).padStart(3, "0")}`;
    const createdAt = iso(base, r.hoursAgo);
    const decidedHoursAgo = r.hoursAgo - 0.5;
    const triaged = r.status !== "new" && r.priority;
    const issue: Issue = {
      id,
      title: r.title,
      description: r.description,
      building: r.building,
      location: r.location,
      category: r.category,
      reporterId: r.reporter[0],
      reporterName: r.reporter[1],
      priority: r.priority,
      status: r.status,
      assignedTeam: triaged ? DEFAULT_TEAM[r.category] : null,
      assignedTo: r.assignedTo ?? null,
      createdAt,
      updatedAt: iso(base, r.resolvedHoursAgo ?? decidedHoursAgo),
      dueAt: triaged ? iso(base, decidedHoursAgo - SLA_HOURS[r.priority!]) : iso(base, r.hoursAgo - TRIAGE_SLA_HOURS),
      resolvedAt: r.resolvedHoursAgo !== undefined ? iso(base, r.resolvedHoursAgo) : null,
      resolutionNotes: r.resolution ?? null,
      photoRef: null,
      resolutionPhotoRef: null,
      isSample: true,
    };
    issues.push(issue);

    const push = (hoursAgo: number, actionType: string, details: Record<string, unknown>, actor = sampleStaff) =>
      activity.push({ id: `${id}-a${activity.length}`, issueId: id, ...actor, actionType, details, createdAt: iso(base, hoursAgo) });

    push(r.hoursAgo, "created", { title: r.title, reporterCategory: r.category }, { actorId: r.reporter[0], actorName: r.reporter[1] });
    if (triaged) {
      push(decidedHoursAgo, "decision_manual", { priority: r.priority, category: r.category, team: issue.assignedTeam, note: "Sample record — triaged manually, no AI assessment." });
    }
    if (r.status === "in_progress" || r.status === "resolved") push(decidedHoursAgo - 0.2, "status_changed", { from: "triaged", to: "in_progress" });
    if (r.resolvedHoursAgo !== undefined) push(r.resolvedHoursAgo, "resolved", { resolutionNotes: r.resolution });
  });

  return { issues, assessments: [], activity };
}
