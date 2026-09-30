import { describe, expect, test } from "vitest";
import {
  $URL,
  parseAuth,
  parseQuery,
  parseURL,
  stringifyParsedURL,
  stringifyQuery,
} from "../src";

// Reads credentials through the public parsing entry points
function authViaParseURL(input: string) {
  return parseAuth(parseURL(input).auth);
}

function authVia$URL(input: string) {
  const url = new $URL(input);
  return { username: url.username, password: url.password };
}

describe("auth credentials consistency", () => {
  // [literal form, percent-encoded form, expected logical value]
  const equivalentForms: Array<[string, string, ReturnType<typeof parseAuth>]> =
    [
      // Plus sign is a literal plus in userinfo (unlike query strings)
      [
        "http://user:p+ss@example.com",
        "http://user:p%2Bss@example.com",
        { username: "user", password: "p+ss" },
      ],
      [
        "http://us+er:pw@example.com",
        "http://us%2Ber:pw@example.com",
        { username: "us+er", password: "pw" },
      ],
      // Spaces in userinfo
      [
        "http://user:p ss@example.com",
        "http://user:p%20ss@example.com",
        { username: "user", password: "p ss" },
      ],
      // Non-ASCII characters in userinfo
      [
        "http://user:päss@example.com",
        "http://user:p%C3%A4ss@example.com",
        { username: "user", password: "päss" },
      ],
      [
        "http://üser:pw@example.com",
        "http://%C3%BCser:pw@example.com",
        { username: "üser", password: "pw" },
      ],
    ];

  for (const [literal, encoded, expected] of equivalentForms) {
    test(`parseAuth and $URL agree for ${encoded}`, () => {
      for (const input of [literal, encoded]) {
        expect(authViaParseURL(input)).toEqual(expected);
        expect(authVia$URL(input)).toEqual(expected);
      }
    });
  }

  test("percent-encoded colon stays inside the password", () => {
    const input = "http://user:p%3Ass@example.com";
    const expected = { username: "user", password: "p:ss" };
    expect(authViaParseURL(input)).toEqual(expected);
    expect(authVia$URL(input)).toEqual(expected);
  });
});

describe("auth parse/stringify stability", () => {
  const inputs = [
    "http://user:p%2Bss@example.com/p%20ath?q=a+b#frag",
    "http://us%2Ber:p%C3%A4ss@example.com:8080/p?q=a%2Bb#f",
    "http://user@example.com/p",
  ];

  for (const input of inputs) {
    test(`parse -> stringify -> parse is stable for ${input}`, () => {
      const parsed = parseURL(input);
      expect(stringifyParsedURL(parsed)).toBe(input);
      expect(parseURL(stringifyParsedURL(parsed))).toEqual(parsed);
    });
  }

  test("modifying one field does not re-encode the others", () => {
    const parsed = parseURL(
      "http://user:p%2Bss@example.com/p%20ath?q=a+b#frag",
    );
    parsed.pathname = "/new";
    expect(stringifyParsedURL(parsed)).toBe(
      "http://user:p%2Bss@example.com/new?q=a+b#frag",
    );
  });

  test("modifying auth does not re-encode the others", () => {
    const parsed = parseURL(
      "http://user:p%2Bss@example.com/p%20ath?q=a+b#frag",
    );
    parsed.auth = "other:c%3Ahange";
    expect(stringifyParsedURL(parsed)).toBe(
      "http://other:c%3Ahange@example.com/p%20ath?q=a+b#frag",
    );
  });

  const hrefCases: Array<[string, string]> = [
    // [input, canonical href]
    ["http://user:p+ss@example.com", "http://user:p%2Bss@example.com"],
    ["http://user:p%2Bss@example.com", "http://user:p%2Bss@example.com"],
    ["http://user:p ss@example.com", "http://user:p%20ss@example.com"],
    ["http://user:päss@example.com", "http://user:p%C3%A4ss@example.com"],
  ];

  for (const [input, href] of hrefCases) {
    test(`$URL href is stable for ${input}`, () => {
      const url = new $URL(input);
      expect(url.href).toBe(href);
      // href re-parses to the same logical credentials
      expect(authViaParseURL(url.href)).toEqual(authVia$URL(input));
      // serializing twice does not drift
      expect(new $URL(url.href).href).toBe(href);
    });
  }
});

describe("query plus-sign contract is untouched", () => {
  test("parseQuery keeps treating + as space", () => {
    expect(parseQuery("?q=a+b")).toEqual({ q: "a b" });
    expect(parseQuery("?q=a%2Bb")).toEqual({ q: "a+b" });
  });

  test("stringifyQuery keeps encoding space as + and + as %2B", () => {
    expect(stringifyQuery({ q: "a b" })).toBe("q=a+b");
    expect(stringifyQuery({ q: "a+b" })).toBe("q=a%2Bb");
  });

  test("credentials and query in the same URL follow their own rules", () => {
    const url = new $URL("http://user:p+ss@example.com/?q=a+b");
    expect(url.password).toBe("p+ss");
    expect(url.query).toEqual({ q: "a b" });
    expect(url.search).toBe("?q=a+b");
    expect(parseURL("http://user:p+ss@example.com/?q=a+b").search).toBe(
      "?q=a+b",
    );
  });
});

describe("existing auth conventions", () => {
  test("no password", () => {
    const expected = { username: "user", password: "" };
    expect(authViaParseURL("http://user@example.com")).toEqual(expected);
    expect(authVia$URL("http://user@example.com")).toEqual(expected);
  });

  test("empty password", () => {
    const expected = { username: "user", password: "" };
    expect(authViaParseURL("http://user:@example.com")).toEqual(expected);
    expect(authVia$URL("http://user:@example.com")).toEqual(expected);
  });

  test("multiple colons keep the first-split convention", () => {
    const expected = { username: "u", password: "a" };
    expect(authViaParseURL("http://u:a:b@example.com")).toEqual(expected);
    expect(authVia$URL("http://u:a:b@example.com")).toEqual(expected);
  });

  test("unicode credentials survive a $URL round trip", () => {
    const url = new $URL("http://üser:päss@example.com");
    expect(url.username).toBe("üser");
    expect(url.password).toBe("päss");
    expect(authViaParseURL(url.href)).toEqual({
      username: "üser",
      password: "päss",
    });
  });
});
