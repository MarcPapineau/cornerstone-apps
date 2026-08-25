# Legacy unattested review records

These records were produced before review attestation existed (correction cycle
2, finding #1). They are retained as **history**, not as evidence.

They are deliberately **not** signed. Signing them now would mean the builder
minting attestations for reviews it did not produce — precisely the forgery the
attestation exists to prevent. An attestation that the builder can grant to any
record it likes proves nothing at all.

The gate does not read this directory. Records here can neither approve nor
block a change. To make one of these reviews count, re-run the reviewer against
the current subject and let the adapter sign the result.
