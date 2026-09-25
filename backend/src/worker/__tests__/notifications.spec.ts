import { escapeHtml } from "../notifications";

describe("escapeHtml", () => {
  it("escapes markup in user text", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
});
