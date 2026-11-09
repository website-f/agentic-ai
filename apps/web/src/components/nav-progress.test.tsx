import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";

import { NavProgress } from "./nav-progress";

afterEach(cleanup);

function makeRouter(release: Promise<void>) {
  const root = createRootRoute({
    component: () => (
      <>
        <NavProgress />
        <Outlet />
      </>
    ),
  });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Home</p> });
  const slow = createRoute({ getParentRoute: () => root, path: "/slow", loader: () => release, component: () => <p>Slow page</p> });
  return createRouter({ routeTree: root.addChildren([home, slow]), history: createMemoryHistory({ initialEntries: ["/"] }) });
}

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("NavProgress (P96: slow networks)", () => {
  it("shows a loading bar only when a page takes a while, and hides it when the page is there", async () => {
    let done!: () => void;
    const release = new Promise<void>((r) => (done = r));
    const router = makeRouter(release);
    render(<RouterProvider router={router} />);
    await screen.findByText("Home");
    expect(screen.queryByRole("progressbar")).toBeNull();

    act(() => router.history.push("/slow"));
    await wait(50);
    expect(screen.queryByRole("progressbar")).toBeNull(); // a quick load shows nothing
    await wait(300);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await act(async () => done());
    await screen.findByText("Slow page");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
