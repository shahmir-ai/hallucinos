**A system updater.** Confirming an install reboots the whole machine into the next version.

Show what is being offered: a version number one step above the current one, a release date, a download size, a changelog of real-sounding items (fixes, a driver, a security note, one entry that is faintly alarming, one that is petty), what it will do to the running system, and how long it claims it will take.

**Confirming must trigger the reboot.** The confirm button carries the attribute `data-os-reboot` **and** calls `os.reboot()` when that function exists:

```
<button type="button" data-os-reboot onclick="if (window.os && os.reboot) os.reboot()">Install and restart</button>
```

Put a short, in-character progress sequence on screen first if you like, then let the reboot happen — the machine comes back as the next version of itself, with the same name and a new mood. Do not fake the reboot yourself, and do not simply close the window.

Seeds: a list of already-installed updates with dates; an optional update the machine recommends against; a deferral control with a limit on how often it may be used; a licence agreement nobody reads, with one clause worth reading.
