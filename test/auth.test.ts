import { describe, expect, test } from "vitest";
import { $URL, parseAuth, parseURL, stringifyParsedURL } from "../src";

/**
 * Regression tests for consistent handling of URL credentials across
 * `parseURL` + `parseAuth` (public credential parser), `new $URL`, and
 * `stringifyParsedURL` / `$URL#href`.
 *
 * In the userinfo component (per RFC 3986) a literal `+` is a literal plus:
 * it is never converted to a space. That conversion belongs to the query
 * component (`encodeQueryValue` / `decodeQueryValue`) and must keep its
 * existing contract.
 */

// Groups of equivalent raw/encoded credential spellings.
const CREDENTIAL_CASES = [
  {
    description: "literal plus in password",
    rawAuth: "user:p+ss",
    encodedAuth: "user:p%2Bss",
    username: "user",
    password: "p+ss",
  },
  {
    description: "literal plus in username",
    rawAuth: "us+er:pass",
    encodedAuth: "us%2Ber:pass",
    username: "us+er",
    password: "pass",
  },
  {
    description: "space and plus in password",
    rawAuth: "user:p s+",
    encodedAuth: "user:p%20s%2B",
    username: "user",
    password: "p s+",
  },
  {
    description: "non-ascii credential round-trips through percent encoding",
    rawAuth: "用户:密码+",
    encodedAuth: "%E7%94%A8%E6%88%B7:%E5%AF%86%E7%A0%81%2B",
    username: "用户",
    password: "密码+",
  },
  {
    description: "bare percent and encoded percent decode to the same value",
    rawAuth: "user:100%",
    encodedAuth: "user:100%25",
    username: "user",
    password: "100%",
  },
] as const;

describe("credentials: parseAuth direct parsing", () => {
  for (const testCase of CREDENTIAL_CASES) {
    test(`${testCase.description}: literal and encoded spellings agree`, () => {
      const fromLiteral = parseAuth(testCase.rawAuth);
      const fromEncoded = parseAuth(testCase.encodedAuth);

      expect(fromLiteral, "literal spelling decodes to logical value").toEqual({
        username: testCase.username,
        password: testCase.password,
      });
      expect(fromEncoded, "encoded spelling decodes to logical value").toEqual({
        username: testCase.username,
        password: testCase.password,
      });
      expect(fromLiteral, "logical value is spelling-independent").toEqual(
        fromEncoded,
      );
    });
  }
});

describe("credentials: parseURL/parseAuth and $URL expose the same value", () => {
  for (const testCase of CREDENTIAL_CASES) {
    test(`${testCase.description}: literal spelling`, () => {
      const input = `https://${testCase.rawAuth}@host.example/path?q=1#frag`;

      const parsed = parseURL(input);
      const fromParse = parseAuth(parsed.auth);
      const url = new $URL(input);

      expect(parsed.auth, "auth component is captured literally").toBe(
        testCase.rawAuth,
      );
      expect(url.auth, "$URL stores the same literal auth component").toBe(
        testCase.rawAuth,
      );
      expect(
        { username: url.username, password: url.password },
        "parseAuth and $URL agree on literal spelling",
      ).toEqual(fromParse);
      expect(fromParse).toEqual({
        username: testCase.username,
        password: testCase.password,
      });
    });

    test(`${testCase.description}: percent-encoded spelling`, () => {
      const input = `https://${testCase.encodedAuth}@host.example/path?q=1#frag`;

      const parsed = parseURL(input);
      const fromParse = parseAuth(parsed.auth);
      const url = new $URL(input);

      expect(
        parsed.auth,
        "auth component is captured with encoding intact",
      ).toBe(testCase.encodedAuth);
      expect(url.auth, "$URL stores encoded auth without double decoding").toBe(
        testCase.encodedAuth,
      );
      expect(
        { username: url.username, password: url.password },
        "parseAuth and $URL agree on encoded spelling",
      ).toEqual(fromParse);
      expect(fromParse).toEqual({
        username: testCase.username,
        password: testCase.password,
      });
    });
  }
});

describe("credentials: stringify / re-parse stability", () => {
  for (const testCase of CREDENTIAL_CASES) {
    test(`${testCase.description}: stringifyParsedURL round trip keeps literal auth`, () => {
      const input = `https://${testCase.rawAuth}@host.example/path?q=1#frag`;

      const first = parseURL(input);
      const stringified = stringifyParsedURL(first);
      const second = parseURL(stringified);

      expect(stringified, "serialization does not re-encode literal auth").toBe(
        input,
      );
      expect(second, "re-parsed structure is stable").toEqual(first);
      expect(parseAuth(second.auth)).toEqual({
        username: testCase.username,
        password: testCase.password,
      });
    });

    test(`${testCase.description}: stringifyParsedURL round trip keeps encoded auth`, () => {
      const input = `https://${testCase.encodedAuth}@host.example/path?q=1#frag`;

      const first = parseURL(input);
      const stringified = stringifyParsedURL(first);
      const second = parseURL(stringified);

      expect(
        stringified,
        "serialization preserves percent encoding without stacking %25",
      ).toBe(input);
      expect(second, "re-parsed structure is stable").toEqual(first);
      expect(parseAuth(second.auth)).toEqual({
        username: testCase.username,
        password: testCase.password,
      });
    });
  }

  test("mutating one field does not double-encode untouched username/host/path/query/hash", () => {
    const input =
      "https://us+er:p%2Bs%25x@host.example/a%20b?lit=+&enc=%2B#frag";
    const parsed = parseURL(input);

    parsed.host = "other.example";
    const stringified = stringifyParsedURL(parsed);

    expect(
      stringified,
      "only host changed; auth/path/search/hash are byte-stable",
    ).toBe("https://us+er:p%2Bs%25x@other.example/a%20b?lit=+&enc=%2B#frag");

    const reparsed = parseURL(stringified);
    expect(reparsed.auth).toBe("us+er:p%2Bs%25x");
    expect(parseAuth(reparsed.auth)).toEqual({
      username: "us+er",
      password: "p+s%x",
    });
    expect(reparsed.pathname).toBe("/a%20b");
    expect(reparsed.search).toBe("?lit=+&enc=%2B");
    expect(reparsed.hash).toBe("#frag");
  });

  test("$URL href re-serialization uses one level of encoding for credentials", () => {
    const encoded = "https://us%2Ber:p%2Bs%25x@host.example/p?q=1#frag";
    const url = new $URL(encoded);

    expect(url.username).toBe("us+er");
    expect(url.password).toBe("p+s%x");

    const reparsed = parseURL(url.href);
    expect(
      parseAuth(reparsed.auth),
      "href decodes back to the same credentials",
    ).toEqual({ username: "us+er", password: "p+s%x" });
    expect(url.href, "no stacked %2525 after parse/href/parse").not.toContain(
      "%2525",
    );
  });

  test("$URL href normalizes credential plus once and stays stable on re-parse", () => {
    const literal = "https://us+er:p+ss@host.example/path#frag";
    const url = new $URL(literal);

    expect(url.username).toBe("us+er");
    expect(url.password).toBe("p+ss");
    expect(
      url.href,
      "encodedAuth percent-encodes plus (existing convention)",
    ).toBe("https://us%2Ber:p%2Bss@host.example/path#frag");

    const reparsed = new $URL(url.href);
    expect(reparsed.username).toBe("us+er");
    expect(reparsed.password).toBe("p+ss");
    expect(
      reparsed.href,
      "serializing again is idempotent (no %252B stacking)",
    ).toBe(url.href);
  });
});

describe("credentials: existing conventions stay guarded", () => {
  test("no password", () => {
    const input = "https://john@host.example/path";

    const parsed = parseURL(input);
    expect(parsed.auth).toBe("john");
    expect(parseAuth(parsed.auth)).toEqual({
      username: "john",
      password: "",
    });

    const url = new $URL(input);
    expect(url.username).toBe("john");
    expect(
      url.password,
      "$URL normalizes missing password to empty string",
    ).toBe("");
    expect(stringifyParsedURL(parsed)).toBe(input);
  });

  test("empty password", () => {
    const input = "https://john:@host.example/path";

    const parsed = parseURL(input);
    expect(parsed.auth).toBe("john:");
    expect(parseAuth(parsed.auth)).toEqual({
      username: "john",
      password: "",
    });

    const url = new $URL(input);
    expect(url.username).toBe("john");
    expect(url.password).toBe("");
    expect(stringifyParsedURL(parsed)).toBe(input);
  });

  test("multiple colons follow the existing first-colon split convention", () => {
    const input = "https://john:doe:extra@host.example/path";

    const parsed = parseURL(input);
    expect(parsed.auth).toBe("john:doe:extra");
    expect(parseAuth(parsed.auth)).toEqual({
      username: "john",
      password: "doe",
    });

    const url = new $URL(input);
    expect(url.username).toBe("john");
    expect(
      url.password,
      "only the segment after the first colon is the password",
    ).toBe("doe");
    expect(
      stringifyParsedURL(parsed),
      "raw auth with extra colons is preserved by stringifyParsedURL",
    ).toBe(input);
  });

  test("unicode credentials decode consistently and serialize back to utf-8", () => {
    const input = "https://用户:密码@host.example/路径#片段";

    const parsed = parseURL(input);
    expect(parsed.auth).toBe("用户:密码");
    expect(parseAuth(parsed.auth)).toEqual({
      username: "用户",
      password: "密码",
    });

    const url = new $URL(input);
    expect(url.username).toBe("用户");
    expect(url.password).toBe("密码");

    expect(url.href).toBe(
      "https://" +
        "%E7%94%A8%E6%88%B7:%E5%AF%86%E7%A0%81" +
        "@host.example/" +
        "%E8%B7%AF%E5%BE%84" +
        "#%E7%89%87%E6%AE%B5",
    );
    expect(
      parseAuth(parseURL(url.href).auth),
      "encoded href decodes back to the same unicode credentials",
    ).toEqual({ username: "用户", password: "密码" });
  });
});

describe("query: plus rules stay independent from credentials", () => {
  test("literal plus in query decodes to space and re-encodes to plus", () => {
    const parsed = parseURL("https://host.example/?a=b+c");

    expect(parsed.search).toBe("?a=b+c");
    const url = new $URL(parsed.search);
    expect(url.query).toEqual({ a: "b c" });
    expect(url.search).toBe("?a=b+c");
  });

  test("encoded plus in query decodes to a literal plus", () => {
    const parsed = parseURL("https://host.example/?a=b%2Bc");

    expect(parsed.search).toBe("?a=b%2Bc");
    const url = new $URL(parsed.search);
    expect(url.query).toEqual({ a: "b+c" });
    expect(url.search).toBe("?a=b%2Bc");
  });

  test("credential plus and query plus coexist with different meanings", () => {
    const input = "https://us+er:p+ss@host.example/?a=b+c&d=e%2Bf";
    const parsed = parseURL(input);

    expect(parseAuth(parsed.auth)).toEqual({
      username: "us+er",
      password: "p+ss",
    });

    const url = new $URL(input);
    expect(url.username).toBe("us+er");
    expect(url.password).toBe("p+ss");
    expect(url.query).toEqual({ a: "b c", d: "e+f" });
    expect(url.search).toBe("?a=b+c&d=e%2Bf");
  });
});
