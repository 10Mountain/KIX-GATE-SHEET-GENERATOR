document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const ganttBtn = document.getElementById('gantt-btn');
    const container = document.getElementById('sheet-container');

    // Add event listeners for Clear buttons
    const clearBtns = document.querySelectorAll('.clear-btn');
    clearBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('data-target');
            if (targetId) {
                const targetEl = document.getElementById(targetId);
                if (targetEl) {
                    targetEl.value = '';
                }
            }
        });
    });

    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            const logData = document.getElementById('flight-log').value;
            const workReleaseData = document.getElementById('work-release').value;
            const userData = document.getElementById('user-text').value;

            let highlightName = "";
            const highlightInput = document.getElementById('highlight-name');
            if (highlightInput) {
                highlightName = highlightInput.value.trim();

                // Special alias for Eric
                const ericAliases = ["eric", "ERIC", "エリック"];
                if (ericAliases.includes(highlightName)) {
                    highlightName = "E・Ｈ";
                }
            }

            if (!logData.trim()) {
                alert('Please paste Flight Log data.');
                return;
            }

            try {
                console.log("Generating Sheet (Version: Fixed Gates 251-260)");
                const flights = processData(logData, userData, workReleaseData);
                renderSheets(flights, highlightName);
            } catch (e) {
                console.error(e);
                alert("Error processing data: " + e.message);
            }
        });
    }

    if (ganttBtn) {
        ganttBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const logData = document.getElementById('flight-log').value;
            const workReleaseData = document.getElementById('work-release').value;
            const userData = document.getElementById('user-text').value;

            if (!logData.trim()) {
                alert('Please paste Flight Log data.');
                return;
            }

            // iPad/Safari Popup Blocker workaround: Open window immediately upon click
            // before any computations, otherwise strict browsers will intercept it.
            const newTab = window.open('about:blank', '_blank');

            try {
                const flights = processData(logData, userData, workReleaseData);
                sessionStorage.setItem('ganttFlights', JSON.stringify(flights));
                
                if (newTab) {
                    newTab.location.href = 'gantt.html'; // Navigate the allowed tab
                } else {
                    // Fallback: If device absolutely forbids popups, just navigate normally.
                     window.location.href = 'gantt.html';
                }
            } catch (err) {
                console.error(err);
                if (newTab) newTab.close();
                alert("Error processing data: " + err.message);
            }
        });
    }

    if (document.body.id === 'gantt-fullscreen-body') {
        const raw = sessionStorage.getItem('ganttFlights');
        if (raw) {
            const flights = JSON.parse(raw).map(f => {
                f.arrVal = new Date(f.arrVal);
                f.depVal = new Date(f.depVal);
                f.sortVal = new Date(f.sortVal);
                return f;
            });
            const wrapper = document.getElementById('gantt-fullscreen-wrapper');
            renderGantt(flights, wrapper, true);
        }
    }
});

// --- Logic ---

function processData(logRaw, userRaw, workReleaseRaw) {
    // 1. Parse User Data
    const userMap = {};
    const userLines = userRaw.trim().split('\n');
    userLines.forEach(line => {
        let parts = line.split('\t');

        // If it's space-separated (no tabs or very few), try custom parsing for email/whiteboard text
        if (parts.length < 2 || !line.includes('\t')) {
            const tokens = line.trim().split(/\s+/);
            if (tokens.length >= 2 && /^\d{2,4}$/.test(tokens[0])) {
                const acn = tokens[0];
                let names = [];
                let chk = "";
                let notesTokens = [];
                const chkKeywords = ["PDSC", "SVC", "SEC", "DAILY", "SVC-CHK", "SVC-chk", "SVC-Chk"];

                let i = 1;
                for (; i < tokens.length; i++) {
                    const t = tokens[i];
                    const upperT = t.toUpperCase();

                    // 1. Is it a known CHK keyword?
                    if (chkKeywords.includes(upperT) || /^SVC/i.test(t) || /^DAILY/i.test(t)) {
                        chk = t.toUpperCase();
                        if (i + 1 < tokens.length && /^(chk|check)$/i.test(tokens[i + 1])) {
                            chk += " " + tokens[i + 1].toUpperCase();
                            i += 2;
                        } else {
                            i++;
                        }
                        break; // Stop parsing names/CHK, the rest are notes
                    }

                    // 2. Does it look like the start of notes?
                    // E.g., numbers like '85.0', '56.2', times like '05:15', or English words (excluding single letter 'X' often used as a mark)
                    // Japanese text is usually NOT the start of notes until we hit these.
                    // Also ensure we don't accidentally break on part of a name (which is extremely rare to be just numbers/English in your context)
                    if (/^[0-9]/.test(t) || (/^[A-Za-z]+/.test(t) && t !== "X" && t !== "x" && !chkKeywords.includes(upperT) && !/^SVC/i.test(t))) {
                        break; // Stop parsing names, this is the start of notes
                    }

                    // 3. Otherwise, it's considered a name (up to 3 allowed)
                    if (names.length < 3) {
                        names.push(t);
                    } else {
                        break; // exceeded max names, the rest are notes
                    }
                }

                // Any remaining tokens are notes
                if (i < tokens.length) {
                    notesTokens = tokens.slice(i);
                }

                parts = [
                    acn,
                    names.length > 0 ? names[0] : "",
                    names.length > 1 ? names[1] : "",
                    names.length > 2 ? names[2] : "",
                    chk,
                    notesTokens.join(" ")
                ];
            } else {
                return; // Skip unrecognizable header or invalid line
            }
        }

        // Pad parts
        while (parts.length < 6) parts.push("");

        const key = parts[0].trim();
        if (!key) return;

        let [main, inSub, outSdr, chk, notes] = parts.slice(1, 6).map(s => s.trim());

        // Formatting replacements
        const format = (s) => s.replace(/、/g, " / ").replace(/, /g, " / ");
        main = format(main);
        inSub = format(inSub);
        outSdr = format(outSdr);

        if (!userMap[key]) {
            userMap[key] = { MAIN: [], IN_SUB: [], OUT_SENDER: [], CHK: [], NOTES: [] };
        }
        if (main) userMap[key].MAIN.push(main);
        if (inSub) userMap[key].IN_SUB.push(inSub);
        if (outSdr) userMap[key].OUT_SENDER.push(outSdr);
        if (chk) userMap[key].CHK.push(chk);
        if (notes) userMap[key].NOTES.push(notes);
    });

    // 2. Parse Work Release Data
    const workReleaseMap = {};
    if (workReleaseRaw && workReleaseRaw.trim()) {
        const wrLines = workReleaseRaw.trim().split('\n');

        // Regex Patterns
        const acnRegex = /^\d{3}$/;
        const ataRegex = /^\d{2}-\d{2}$/;
        const dateRegex = /^\d{2}[A-Z]{3}\d{2}$/; // e.g. 02MAR21
        const timeRegex = /:/; // Colon indicates time
        const dotNumRegex = /^\.\d+/; // Starts with dot e.g. .0 or .275

        let currentEntry = null;

        const saveEntry = (entry) => {
            if (!entry || !entry.rawText) return;

            const parts = entry.rawText.split(/\s+/);
            const acn = parts[0];
            const ata = parts[1];
            
            let nbr = "";
            if (/^\d{4}$/.test(parts[2])) {
                nbr = parts[2];
            } else if (/^\d{4}$/.test(parts[3])) {
                nbr = parts[3];
            } else {
                nbr = parts[2] || "";
            }

            // Find Open Date index
            let dateIdx = -1;
            for (let i = 3; i < parts.length; i++) {
                if (dateRegex.test(parts[i])) {
                    dateIdx = i;
                    break;
                }
            }

            if (dateIdx === -1) {
                return; // Invalid row
            }

            // Check for Fact Tm
            for (let i = 2; i < dateIdx; i++) {
                if (timeRegex.test(parts[i]) || dotNumRegex.test(parts[i])) {
                    return; // Completed task, skip
                }
            }

            // Extract Description Start
            let descStartFunc = -1;
            // Strategy: Find "N N N" pattern after Date
            for (let i = dateIdx + 1; i < parts.length - 2; i++) {
                if (parts[i] === 'N' && parts[i + 1] === 'N' && parts[i + 2] === 'N') {
                    descStartFunc = i + 3;
                    break;
                }
            }

            let discrpRaw = "";
            if (descStartFunc !== -1 && descStartFunc < parts.length) {
                discrpRaw = parts.slice(descStartFunc).join(" ");
            } else {
                // Fallback
                const fallbackIdx = dateIdx + 6;
                if (parts.length > fallbackIdx) {
                    discrpRaw = parts.slice(fallbackIdx).join(" ");
                }
            }

            // finalize description
            let discrpStr = discrpRaw.replace(/\s+/g, ' ').trim();

            // Remove "Report generated by..." boilerplate 
            discrpStr = discrpStr.replace(/Report generated by:.*?All paper copies are for REFERENCE ONLY Page \d+/g, '').trim();

            // Format EGPWS LOAD note mapping from "LOAD CURRENT VERSION EGPWS H-XXX" to "LOAD EGPWS H-XXX"
            discrpStr = discrpStr.replace(/LOAD\s+CURRENT\s+VERSION\s+EGPWS\s+(H-\w+)(?:\s|$).*/i, 'LOAD EGPWS $1');

            // Rule: If description contains "tire" (case-insensitive), keep as is
            if (/tire/i.test(discrpStr)) {
                // Keep
            } else {
                // Rule: ATA 05-23 implies SVC CHK, or if description text matches SVC CHECK
                if (ata === "05-23" || /svc\s*check/i.test(discrpStr) || /service\s*check/i.test(discrpStr)) {
                    discrpStr = "SVC CHK";
                }
            }

            if (/MOD\s+TYPE\s+W\s+MOD\s+NO\.?\s*G-1208100-00-02/i.test(discrpStr)) {
                discrpStr = "PIVOT LUB";
            } else if (/MOD\s+TYPE\s+E\s+MOD\s+NO\.?\s*H-3131-7-5001/i.test(discrpStr)) {
                discrpStr = "PCMCIA CARD";
            } else if (/MOD\s+TYPE\s+W\s+MOD\s+NO\.?\s*G-2716000-00-01/i.test(discrpStr)) {
                discrpStr = "ACE MONITORING";
            } else if (/MOD\s+TYPE\s+W\s+MOD\s+NO\.?\s*G-2714000-00-01/i.test(discrpStr)) {
                discrpStr = "PFC";
            } else if (/MOD\s+TYPE\s+E\s+MOD\s+NO\.?\s*G-2560-E0323447/i.test(discrpStr)) {
                discrpStr = "EVAS CHK";
            } else if (/MOD\s+TYPE\s+E\s+MOD\s+NO\.?\s*H-2560-E0324416/i.test(discrpStr)) {
                discrpStr = "EVAS INSP";
            } else if (ata === "05-43" && /UPDATE\s+COMPUTER\s+WITH\s+CURRENT/i.test(discrpStr)) {
                discrpStr = "FMS NAV DATA UPDATE";
            } else if (ata === "05-43" && /UPDATE\s+#1\s+AND\s+#2\s+EFB'S\s+WITH/i.test(discrpStr)) {
                discrpStr = "EFB UPDATE";
            } else if (ata === "05-00" && /MOD\s+NO\.?\s*H-2701000-00-02/i.test(discrpStr)) {
                discrpStr = "RUDDER PCU OPS";
            } else if (ata === "05-00" && /MOD\s+NO\.?\s*H-2701800-00-01/i.test(discrpStr)) {
                discrpStr = "ELEVATOR PCU OPS";
            } else if (/H-3100200-00-01/i.test(discrpStr)) {
                discrpStr = "DFDR ULB BATTERY INSP";
            } else if (/H-2300500-00-01/i.test(discrpStr)) {
                discrpStr = "VOICE RCDR ULB BATTERY INSP";
            }

            let noteText = `ATA ${ata} / ${nbr} / ${discrpStr}`;

            if (!workReleaseMap[acn]) {
                workReleaseMap[acn] = [];
            }
            workReleaseMap[acn].push(noteText);
        };

        wrLines.forEach(line => {
            if (!line.trim()) return;

            // Split by whitespace
            const parts = line.trim().split(/\s+/);

            // Check if this line starts a new record?
            // Needs to look like ACN (3 digits) + ATA (2-2 digits)
            const isNewRecord = parts.length >= 2 && acnRegex.test(parts[0]) && ataRegex.test(parts[1]);

            if (isNewRecord) {
                // Save previous
                saveEntry(currentEntry);
                currentEntry = { rawText: line.trim() };
            } else {
                // Continuation Line
                if (currentEntry) {
                    currentEntry.rawText += " " + line.trim();
                }
            }
        });

        // Save last
        saveEntry(currentEntry);
    }

    const joinVals = (arr) => [...new Set(arr)].join(" / ");

    // 3. Parse Flight Log
    let flights = [];
    const logLines = logRaw.trim().split('\n');

    logLines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.trim().split(/\t+/);
        if (parts.length < 8) return;

        const flt3 = parts[0].trim();

        // Parse Dates
        // Expected Format: "123  28/02 10:00" -> parts[3]
        const inMatch = parts[3].match(/(\d+)\/(\d{2})\s+(\d{2}:\d{2})/);
        const outMatch = parts[8].match(/(\d+)\/(\d{2})\s+(\d{2}:\d{2})/);

        if (!inMatch || !outMatch) return;

        const [_, inFlt, inDay, inTime] = inMatch;
        const [__, outFlt, outDay, outTime] = outMatch;

        // Convert to JST (UTC+9)
        const toJST = (dStr, tStr) => {
            const [h, m] = tStr.split(':').map(Number);
            const refDate = parseInt(dStr);

            // Use current year/month to align with "Now" axis
            const now = new Date();
            let year = now.getFullYear();
            let month = now.getMonth(); // 0-indexed

            // Handle month rollover (e.g., today is 2nd, but we have data for 28th, 29th, 30th, 31st)
            if (now.getDate() <= 10 && refDate >= 25) {
                month -= 1;
                if (month < 0) {
                    month = 11;
                    year -= 1;
                }
            } else if (now.getDate() >= 25 && refDate <= 5) {
                // Also handle if today is end of month and we have next month's data
                month += 1;
                if (month > 11) {
                    month = 0;
                    year += 1;
                }
            }

            const date = new Date(Date.UTC(year, month, refDate, h, m));
            date.setHours(date.getHours() + 9);

            const newDay = String(date.getUTCDate()).padStart(2, '0');
            const newTime = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
            return { day: newDay, time: newTime, dt: date };
        };

        const inJST = toJST(inDay, inTime);
        const outJST = toJST(outDay, outTime);

        const orig = parts[4].trim();
        const gate = parts[5].trim();
        const dest = parts.length > 10 ? parts[10].trim() : "";

        // Auto PDSC Check
        let chk = "";
        let chkBg = "white";
        const pdscDest = ['ANC', 'MEM', 'ING', 'OAK', 'IND'];
        if (flt3.startsWith('8') && pdscDest.includes(dest)) {
            chk = "PDSC";
            chkBg = "bg-pink";
        }

        flights.push({
            GATE: gate, FLT_3: flt3,
            MAIN: "", IN_SUB: "", OUT_SENDER: "", CHK: chk, NOTES: "",
            CHK_BG: chkBg,
            ORIG: orig,
            IN_FLT: inFlt, IN_DAY: inJST.day, ARR_JST: inJST.time,
            DEST: dest,
            OUT_FLT: outFlt, OUT_DAY: outJST.day, DEP_JST: outJST.time,
            sortVal: inJST.dt, NOTE_COLOR: "black",
            arrVal: inJST.dt, depVal: outJST.dt, // Store Date objects for Gantt
            acn: flt3
        });
    });

    // 3. Add missing user flights (dummy entries)
    const loggedFlts = new Set(flights.map(f => f.FLT_3));
    Object.keys(userMap).forEach(key => {
        if (!loggedFlts.has(key) && /^\d+$/.test(key)) {
            flights.push({
                GATE: "???", FLT_3: key,
                MAIN: "", IN_SUB: "", OUT_SENDER: "", CHK: "", NOTES: "",
                CHK_BG: "white",
                ORIG: "???", IN_FLT: "??", IN_DAY: "??", ARR_JST: "??:??",
                DEST: "???", OUT_FLT: "??", OUT_DAY: "??", DEP_JST: "??:??",
                sortVal: new Date(2026, 2, 28, 23, 59), NOTE_COLOR: "black",
                arrVal: new Date(2026, 2, 28, 23, 59), depVal: new Date(2026, 2, 28, 23, 59),
                acn: key
            });
        }
    });

    // 4. Sort
    flights.sort((a, b) => a.sortVal - b.sortVal);

    // 5. Merge User Data & Work Release & Styles
    flights.forEach(f => {
        const u = userMap[f.FLT_3];

        // Merge User Data (Personnel/Memo)
        if (u) {
            f.MAIN = joinVals(u.MAIN);
            f.IN_SUB = joinVals(u.IN_SUB);
            f.OUT_SENDER = joinVals(u.OUT_SENDER);
            const textChk = joinVals(u.CHK);
            if (textChk) {
                f.CHK = textChk;
            }
            f.NOTES = u.NOTES.join(" / ");
        }

        // Merge Work Release Data
        const wrNotes = workReleaseMap[f.FLT_3];
        if (wrNotes && wrNotes.length > 0) {
            const wrText = wrNotes.join("[[SPACER]]");
            if (f.NOTES) {
                f.NOTES += "[[SPACER]]" + wrText;
            } else {
                f.NOTES = wrText;
            }

            // Rule: If SVC CHK is present in Work Release notes, set CHK to SVC CHK and bg-pink
            if (wrText.includes("SVC CHK")) {
                f.CHK = "SVC CHK";
                f.CHK_BG = "bg-pink";
            }
        }

        // Background Logic
        if ((f.CHK && (/PDSC/i.test(f.CHK) || /DAILY/i.test(f.CHK) || /SVC/i.test(f.CHK))) ||
            (f.FLT_3.startsWith('8') && ['ANC', 'MEM', 'ING', 'OAK', 'IND'].includes(f.DEST))) {
            f.CHK_BG = "bg-pink";
        }

        // Text Color Logic (Notes)
        if (f.NOTES.includes("赤")) {
            f.NOTE_COLOR = "red";
            f.NOTES = f.NOTES.replace(/[\(（].*?赤.*?[\)）]/g, "");
        } else if (f.NOTES.includes("青")) {
            f.NOTE_COLOR = "blue";
            f.NOTES = f.NOTES.replace(/[\(（].*?青.*?[\)）]/g, "");
        } else if (f.NOTES.includes("緑")) {
            f.NOTE_COLOR = "green";
            f.NOTES = f.NOTES.replace(/[\(（].*?緑.*?[\)）]/g, "");
        }
        f.NOTES = f.NOTES.trim();
    });

    return flights;
}

// --- Rendering ---

function renderSheets(flights, highlightName) {
    const container = document.getElementById('sheet-container');
    container.innerHTML = ''; // Clear previous

    const chunks = [
        flights.slice(0, 7),
        flights.slice(7)
    ];

    chunks.forEach((chunk, pageIndex) => {
        const page = document.createElement('div');
        page.className = 'sheet-page';
        page.id = `page-${pageIndex + 1}`;

        // Header
        const header = document.createElement('div');
        header.className = 'sheet-header';
        const cols = ["GATE", "ACN", "CHK", "MAIN", "IN SUB", "OUT SDR", "ORIG", "INBD FLT", "DEST", "OUTBD FLT"];
        cols.forEach((c, idx) => {
            const div = document.createElement('div');
            div.className = `header-cell col-${idx}`;
            div.textContent = c;
            header.appendChild(div);
        });
        page.appendChild(header);

        // Rows
        chunk.forEach(f => {
            const block = document.createElement('div');
            block.className = 'flight-block';

            // Top Half: Data
            const dataRow = document.createElement('div');
            dataRow.className = 'data-row';

            const inStr = `${f.IN_FLT}/${f.IN_DAY}\n${f.ARR_JST}`;
            const outStr = `${f.OUT_FLT}/${f.OUT_DAY}\n${f.DEP_JST}`;

            const cellValues = [
                f.GATE, f.FLT_3, f.CHK, f.MAIN, f.IN_SUB, f.OUT_SENDER,
                f.ORIG, inStr, f.DEST, outStr
            ];

            cellValues.forEach((val, idx) => {
                const div = document.createElement('div');
                div.className = `data-cell col-${idx}`;
                div.textContent = val;

                // Specific Cell Highlights
                // CHK cell (idx 2)
                const hasSVC = (f.CHK && /SVC/i.test(f.CHK)) || (f.NOTES && /SVC/i.test(f.NOTES));
                if (idx === 2 && (f.CHK_BG === 'bg-pink' || hasSVC)) {
                    div.classList.add('bg-pink');
                }

                // Personnel Highlight (MAIN=3, IN_SUB=4, OUT_SENDER=5)
                if (highlightName && [3, 4, 5].includes(idx) && val.includes(highlightName)) {
                    div.style.backgroundColor = '#FFFFE0'; // Light Yellow
                }

                dataRow.appendChild(div);
            });
            block.appendChild(dataRow);

            // Bottom Half: Notes
            const notesRow = document.createElement('div');
            notesRow.className = 'notes-row';

            // Escape HTML basic chars for safety, then apply specific formatting
            const escapeHtml = (unsafe) => {
                return (unsafe || "").toString()
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };

            let safeNotes = escapeHtml(`Notes: ${f.NOTES}`);
            // Highlight 'spj push' in blue (case-insensitive)
            safeNotes = safeNotes.replace(/(spj\s*push)/ig, '<span style="color: blue; font-weight: bold;">$1</span>');
            // Insert wide spacing for multiple Work Release data entries
            safeNotes = safeNotes.replace(/\[\[SPACER\]\]/g, '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');

            notesRow.innerHTML = safeNotes;
            notesRow.style.color = f.NOTE_COLOR;
            block.appendChild(notesRow);

            page.appendChild(block);
        });

        // Add Gantt Chart to Page 2 only if flights are less than 13
        if (pageIndex === 1 && flights.length < 13) {
            renderGantt(flights, page);
        }

        container.appendChild(page);
    });
}

function renderGantt(flights, container, isFullscreen = false) {
    if (flights.length === 0) return;

    // 1. Calculate Time Axis based on current time
    const now = new Date();
    const nowJST = new Date(now.getTime() + 9 * 3600000);
    const jstHour = nowJST.getUTCHours();
    const jstMinute = nowJST.getUTCMinutes();
    const totalMins = jstHour * 60 + jstMinute;

    let startTime, endTime;

    // Use unified 24-hour timeline (06:00 to 06:00 next day) for all Gantt charts
    startTime = new Date(nowJST);
    startTime.setUTCHours(6, 0, 0, 0);

    endTime = new Date(startTime);
    endTime.setUTCDate(endTime.getUTCDate() + 1);
    endTime.setUTCHours(6, 0, 0, 0);

    // 2. Prepare Gate Axis (FIXED: 251-260)
    const sortedGates = ["251", "252", "253", "254", "255", "256", "257", "258", "259", "260"];

    const ganttContainer = document.createElement('div');
    ganttContainer.className = isFullscreen ? 'gantt-container fullscreen' : 'gantt-container';

    // Title
    const title = document.createElement('div');
    title.className = 'gantt-title';

    if (isFullscreen) {
        const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const d = String(startTime.getUTCDate()).padStart(2, '0');
        const m = months[startTime.getUTCMonth()];
        const y = String(startTime.getUTCFullYear()).slice(-2);
        
        const gh = String(nowJST.getUTCHours()).padStart(2, '0');
        const gm = String(nowJST.getUTCMinutes()).padStart(2, '0');
        
        const generatedText = `Gen: ${gh}:${gm}`;
        title.innerHTML = `<span>KIX GATE GANTT CHART</span> <span class="title-date-block">${d} ${m} '${y} <span style="font-size: 12px; margin-left: 10px; font-weight: normal;">(${generatedText})</span></span>`;
    } else {
        const sHour = String(startTime.getUTCHours()).padStart(2, '0');
        const sMin = String(startTime.getUTCMinutes()).padStart(2, '0');
        const eHour = String(endTime.getUTCHours()).padStart(2, '0');
        const eMin = String(endTime.getUTCMinutes()).padStart(2, '0');
        title.textContent = `GATE GANTT CHART (${sHour}:${sMin} - ${eHour}:${eMin} JST)`;
    }
    ganttContainer.appendChild(title);

    // Body (Gate Axis + Chart Area + Bottom Row)
    const body = document.createElement('div');
    body.className = 'gantt-body';
    ganttContainer.appendChild(body);

    const timeRow = document.createElement('div');
    timeRow.className = 'gantt-time-row';

    const mainRow = document.createElement('div');
    mainRow.className = 'gantt-main-row';

    const cornerSpacer = document.createElement('div');
    cornerSpacer.className = 'gantt-corner-spacer';

    const gateAxis = document.createElement('div');
    gateAxis.className = 'gantt-gate-axis';

    const chartArea = document.createElement('div');
    chartArea.className = 'gantt-chart-area';

    const timeAxisArea = document.createElement('div');
    timeAxisArea.className = 'gantt-time-axis-area';

    if (isFullscreen) {
        const flexRow = document.createElement('div');
        flexRow.className = 'gantt-flex-row';
        body.appendChild(flexRow);

        const leftPanel = document.createElement('div');
        leftPanel.className = 'gantt-fixed-left';
        flexRow.appendChild(leftPanel);

        cornerSpacer.innerHTML = '<span class="corner-time">TIME</span><span class="corner-gate">GATE</span>';
        leftPanel.appendChild(cornerSpacer);
        leftPanel.appendChild(gateAxis);

        const rightPanel = document.createElement('div');
        rightPanel.className = 'gantt-scroll-right';
        flexRow.appendChild(rightPanel);

        const scrollContent = document.createElement('div');
        scrollContent.className = 'gantt-scroll-content';
        rightPanel.appendChild(scrollContent);

        timeRow.appendChild(timeAxisArea);
        scrollContent.appendChild(timeRow);

        mainRow.appendChild(chartArea);
        scrollContent.appendChild(mainRow);
    } else {
        timeRow.appendChild(cornerSpacer);
        timeRow.appendChild(timeAxisArea);
        body.appendChild(timeRow);

        mainRow.appendChild(gateAxis);
        mainRow.appendChild(chartArea);
        body.appendChild(mainRow);
    }

    const numRows = sortedGates.length;
    // We need to calculate row height dynamically or use fixed
    const rowHeight = 100 / numRows; // Percentage height

    sortedGates.forEach((g, idx) => {
        const label = document.createElement('div');
        label.className = 'gantt-gate-label';
        label.style.top = `${idx * rowHeight}%`;
        label.style.height = `${rowHeight}%`;
        label.textContent = g;
        gateAxis.appendChild(label);
    });

    const totalDuration = endTime - startTime;

    // Draw Time Grid Lines on the hour
    let currentHourTime = new Date(startTime);
    currentHourTime.setUTCMinutes(0, 0, 0);
    if (startTime.getUTCMinutes() > 0) {
        currentHourTime.setUTCHours(currentHourTime.getUTCHours() + 1);
    }

    while (currentHourTime <= endTime) {
        const offsetMs = currentHourTime - startTime;
        const leftPct = (offsetMs / totalDuration) * 100;

        // Line
        const line = document.createElement('div');
        line.className = 'gantt-grid-line';
        line.style.left = `${leftPct}%`;
        chartArea.appendChild(line);

        // Label
        const label = document.createElement('div');
        label.className = 'gantt-axis-label';
        label.style.left = `${leftPct}%`;
        label.textContent = `${String(currentHourTime.getUTCHours()).padStart(2, '0')}:00`;

        if (isFullscreen) {
            label.style.transform = 'translate(-50%, -50%)';
        } else {
            if (leftPct === 0) {
                label.style.transform = 'translateX(0)';
            } else if (leftPct >= 100) {
                label.style.transform = 'translateX(-100%)';
            }
        }

        timeAxisArea.appendChild(label);

        // Next hour
        currentHourTime.setUTCHours(currentHourTime.getUTCHours() + 1);
    }

    // Draw Row Grid Lines
    for (let i = 0; i < numRows; i++) {
        const line = document.createElement('div');
        line.className = 'gantt-grid-line-row';
        line.style.top = `${(i + 1) * rowHeight}%`;
        chartArea.appendChild(line);
    }

    // Draw Bars
    flights.forEach((f) => {
        const gateIdx = sortedGates.indexOf(String(f.GATE)); // Ensure string comparison
        if (gateIdx === -1) return;

        // Calculate X Position
        const startPct = ((f.arrVal - startTime) / totalDuration) * 100;
        const endPct = ((f.depVal - startTime) / totalDuration) * 100;

        if (endPct < 0 || startPct > 100) return;

        const visibleStartPct = Math.max(0, startPct);
        
        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        bar.style.left = `${visibleStartPct}%`;

        // Y Position based on Gate Row
        bar.style.top = `${gateIdx * rowHeight + (rowHeight * 0.1)}%`; // 10% of row height padding top within row
        bar.style.height = `${rowHeight * 0.8}%`; // 80% of row height

        // Color
        let bgColor = 'lightblue';
        const acnStr = String(f.acn || '');
        if (acnStr.startsWith('8')) {
            bgColor = '#ce93d8'; // Slightly darker Purple (Material 200)
        } else if (acnStr.startsWith('1')) {
            bgColor = '#fbc02d'; // Darker Yellow (Material 700) for white text legibility
        } else if (acnStr.startsWith('5')) {
            bgColor = '#c8e6c9'; // Light Green (Material 100)
        }

        bar.style.backgroundColor = bgColor;

        const diffMs = f.depVal - f.arrVal;
        const totalMinutes = Math.floor(diffMs / 60000); 

        let widthPct = endPct - visibleStartPct;
        if (widthPct > 100 - visibleStartPct) widthPct = 100 - visibleStartPct;
        bar.style.width = `${widthPct}%`;

        if (isFullscreen) {

            // Content
            const innerContent = document.createElement('div');
            innerContent.className = 'gb-container';

            // Left Side
            const leftSide = document.createElement('div');
            leftSide.className = 'gb-side gb-left';
            leftSide.innerHTML = `
                <div class="gb-time">${f.ARR_JST || '--:--'}</div>
                <div class="gb-bottom">
                    <div class="gb-box gb-border-right">${f.ORIG || '---'}</div>
                    <div class="gb-box">${f.IN_FLT || '---'}</div>
                </div>
            `;

            // Center ACN
            const centerSide = document.createElement('div');
            centerSide.className = 'gb-center';
            const maxTextFontSize = 'calc((100vh - 75px) * 0.056)';
            const chkText = f.CHK ? `<span class="gb-chk">(${f.CHK})</span>` : '';
            centerSide.innerHTML = `<div class="acn-wrapper"><span class="acn-max-text" style="font-size: ${maxTextFontSize};">${f.acn}</span>${chkText}</div>`;

            // Right Side
            const rightSide = document.createElement('div');
            rightSide.className = 'gb-side gb-right';
            rightSide.innerHTML = `
                <div class="gb-time">${f.DEP_JST || '--:--'}</div>
                <div class="gb-bottom">
                    <div class="gb-box gb-border-right">${f.OUT_FLT || '---'}</div>
                    <div class="gb-box">${f.DEST || '---'}</div>
                </div>
            `;

            innerContent.appendChild(leftSide);
            innerContent.appendChild(centerSide);
            innerContent.appendChild(rightSide);
            
            bar.appendChild(innerContent);

            // Duration GND TIME (> 6 hours)
            if (totalMinutes >= 360) {
                const diffH = Math.floor(totalMinutes / 60);
                const diffM = totalMinutes % 60;
                const durStr = `${String(diffH).padStart(2, '0')}:${String(diffM).padStart(2, '0')}`;
                
                const gndLabel = document.createElement('div');
                gndLabel.className = 'gb-gnd-time';
                gndLabel.textContent = `GND TIME ${durStr}`;
                bar.appendChild(gndLabel);
            }
        } else {

            const chkStr = f.CHK ? f.CHK : '-';
            let displayText = `<div style="background-color: white; height: 100%; display: flex; align-items: center; padding: 0 6px;"><span style="font-weight: bold; font-size: 14px;">${f.acn}</span> <span style="font-size: 11px; font-weight: normal; margin-left: 3px;">(${chkStr})</span></div>`;
            
            // Duration GND TIME (> 6 hours)
            if (totalMinutes >= 360) {
                const diffH = Math.floor(totalMinutes / 60);
                const diffM = totalMinutes % 60;
                const durStr = `${String(diffH).padStart(2, '0')}:${String(diffM).padStart(2, '0')}`;
                displayText += `<span style="font-size: 10px; color: #000080; font-weight: bold; margin-left: 5px;">GND TIME ${durStr}</span>`;
            }
            
            bar.innerHTML = displayText;
            bar.style.color = 'black';
            bar.style.overflow = 'hidden';
            bar.style.whiteSpace = 'nowrap';
        }

        chartArea.appendChild(bar);
    });

    container.appendChild(ganttContainer);
}
