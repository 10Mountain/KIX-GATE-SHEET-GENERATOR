document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const container = document.getElementById('sheet-container');

    generateBtn.addEventListener('click', () => {
        const logData = document.getElementById('flight-log').value;
        const workReleaseData = document.getElementById('work-release').value;
        const userData = document.getElementById('user-text').value;

        let highlightName = "";
        const highlightInput = document.getElementById('highlight-name');
        if (highlightInput) {
            highlightName = highlightInput.value.trim();
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
                    if (chkKeywords.includes(upperT) || /^SVC/i.test(t)) {
                        chk = t;
                        i++; // Move to next for notes
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
            if (!entry || entry.skip) return;

            // finalize description
            let discrpStr = entry.discrpRaw.replace(/\s+/g, ' ').trim();

            // Remove "Report generated by..." boilerplate 
            discrpStr = discrpStr.replace(/Report generated by:.*?All paper copies are for REFERENCE ONLY Page \d+/g, '').trim();

            // Format EGPWS LOAD note mapping from "LOAD CURRENT VERSION EGPWS H-XXX" to "LOAD EGPWS H-XXX"
            discrpStr = discrpStr.replace(/LOAD\s+CURRENT\s+VERSION\s+EGPWS\s+(H-\w+)(?:\s|$).*/i, 'LOAD EGPWS $1');

            // Rule: If description contains "tire" (case-insensitive), keep as is
            if (/tire/i.test(discrpStr)) {
                // Keep
            } else {
                // Rule: ATA 05-23 implies SVC CHK, or if description text matches SVC CHECK
                if (entry.ata === "05-23" || /svc\s*check/i.test(discrpStr) || /service\s*check/i.test(discrpStr)) {
                    discrpStr = "SVC CHK";
                }
            }

            if (!workReleaseMap[entry.acn]) {
                workReleaseMap[entry.acn] = [];
            }
            workReleaseMap[entry.acn].push(`ATA: ${entry.ata} / ${discrpStr}`);
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
                currentEntry = null;

                // Start new
                const acn = parts[0];
                const ata = parts[1];
                let skip = false;

                // Find Open Date index
                let dateIdx = -1;
                for (let i = 3; i < parts.length; i++) {
                    if (dateRegex.test(parts[i])) {
                        dateIdx = i;
                        break;
                    }
                }

                if (dateIdx === -1) {
                    skip = true; // Invalid row
                } else {
                    // Check for Fact Tm
                    for (let i = 2; i < dateIdx; i++) {
                        if (timeRegex.test(parts[i]) || dotNumRegex.test(parts[i])) {
                            skip = true;
                            break;
                        }
                    }
                }

                if (skip) {
                    currentEntry = { skip: true };
                    return;
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

                currentEntry = { acn, ata, discrpRaw, skip: false };

            } else {
                // Continuation Line
                if (currentEntry && !currentEntry.skip) {
                    currentEntry.discrpRaw += " " + line.trim();
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

            // Use current year/month to align with "Now" axis
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth(); // 0-indexed

            const date = new Date(Date.UTC(year, month, parseInt(dStr), h, m));
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
            const wrText = wrNotes.join("\n");
            if (f.NOTES) {
                f.NOTES += "\n" + wrText;
            } else {
                f.NOTES = wrText;
            }

            // Rule: If SVC CHK is present in Work Release notes, set CHK to SVC and bg-pink
            if (wrText.includes("SVC CHK")) {
                f.CHK = "SVC";
                f.CHK_BG = "bg-pink";
            }
        }

        // Background Logic
        if ((f.CHK && (f.CHK.includes("PDSC") || f.CHK.includes("DAILY"))) ||
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
                const hasSVC = (f.CHK && /SVC-chk/i.test(f.CHK)) || (f.NOTES && /SVC-chk/i.test(f.NOTES));
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
            notesRow.textContent = `Notes: ${f.NOTES}`;
            notesRow.style.color = f.NOTE_COLOR;
            block.appendChild(notesRow);

            page.appendChild(block);
        });

        // Add Gantt Chart to Page 2
        if (pageIndex === 1) {
            renderGantt(flights, page);
        }

        container.appendChild(page);
    });
}

function renderGantt(flights, container) {
    if (flights.length === 0) return;

    // 1. Calculate Time Axis: Created Time - 2h to +12h (Total 14h)
    const now = new Date();
    const nowSchema = new Date(now.getTime() + 9 * 3600000);
    const startTime = new Date(nowSchema.getTime() - 2 * 3600000);
    const endTime = new Date(nowSchema.getTime() + 12 * 3600000);

    // 2. Prepare Gate Axis (FIXED: 251-260)
    const sortedGates = ["251", "252", "253", "254", "255", "256", "257", "258", "259", "260"];

    const ganttContainer = document.createElement('div');
    ganttContainer.className = 'gantt-container';

    // Title
    const title = document.createElement('div');
    title.className = 'gantt-title';
    title.textContent = `GATE GANTT CHART (${startTime.getUTCHours()}:00 - ${endTime.getUTCHours()}:00 JST)`;
    ganttContainer.appendChild(title);

    // Body (Gate Axis + Chart Area + Bottom Row)
    const body = document.createElement('div');
    body.className = 'gantt-body';
    ganttContainer.appendChild(body);

    const mainRow = document.createElement('div');
    mainRow.style.display = 'flex';
    mainRow.style.flexDirection = 'row';
    mainRow.style.flex = '1';
    body.appendChild(mainRow);

    const bottomRow = document.createElement('div');
    bottomRow.style.display = 'flex';
    bottomRow.style.flexDirection = 'row';
    bottomRow.style.height = '15px';
    body.appendChild(bottomRow);

    // --- Gate Axis (Left) ---
    const gateAxis = document.createElement('div');
    gateAxis.className = 'gantt-gate-axis';
    mainRow.appendChild(gateAxis);

    // --- Bottom Corner Spacer (Left) ---
    const cornerSpacer = document.createElement('div');
    cornerSpacer.style.width = '40px'; // Matching gateAxis width
    cornerSpacer.style.borderRight = '2px solid black';
    cornerSpacer.style.boxSizing = 'border-box';
    bottomRow.appendChild(cornerSpacer);

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

    // --- Chart Area (Right) ---
    const chartArea = document.createElement('div');
    chartArea.className = 'gantt-chart-area';
    mainRow.appendChild(chartArea);

    const timeAxisArea = document.createElement('div');
    timeAxisArea.style.flex = '1';
    timeAxisArea.style.position = 'relative';
    bottomRow.appendChild(timeAxisArea);

    const totalDuration = endTime - startTime;

    // Draw Time Grid Lines
    for (let i = 0; i <= 14; i++) {
        const leftPct = (i / 14) * 100;

        // Line
        const line = document.createElement('div');
        line.className = 'gantt-grid-line';
        line.style.left = `${leftPct}%`;
        chartArea.appendChild(line);

        // Label (Bottom)
        const label = document.createElement('div');
        label.className = 'gantt-axis-label';
        label.style.left = `${leftPct}%`;
        const t = new Date(startTime.getTime() + i * 3600000);
        label.textContent = `${String(t.getUTCHours()).padStart(2, '0')}:00`;
        timeAxisArea.appendChild(label);
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
        const widthPct = endPct - startPct;

        if (endPct < 0 || startPct > 100) return;

        const bar = document.createElement('div');
        bar.className = 'gantt-bar';
        bar.style.left = `${Math.max(0, startPct)}%`;
        bar.style.width = `${Math.min(100 - Math.max(0, startPct), widthPct)}%`;

        // Y Position based on Gate Row
        // Add a bit of padding within the row
        bar.style.top = `${gateIdx * rowHeight + (rowHeight * 0.1)}%`; // 10% of row height padding top within row
        bar.style.height = `${rowHeight * 0.8}%`; // 80% of row height

        // Color
        if (f.CHK_BG === 'bg-pink') {
            bar.classList.add('bg-pink');
        } else {
            bar.style.backgroundColor = 'lightblue';
        }

        // Content
        const textContainer = document.createElement('div');
        textContainer.className = 'gantt-bar-text';
        textContainer.style.display = 'flex';
        textContainer.style.gap = '5px';

        const acnLabel = document.createElement('span');
        acnLabel.textContent = `${f.acn} (${f.CHK || '-'})`;
        textContainer.appendChild(acnLabel);

        // Duration
        const diffMs = f.depVal - f.arrVal;
        const totalMinutes = Math.floor(diffMs / 60000); // Calculate total minutes
        const diffH = Math.floor(totalMinutes / 60);
        const diffM = totalMinutes % 60;
        const durStr = `${String(diffH).padStart(2, '0')}:${String(diffM).padStart(2, '0')}`;

        // Only show if GND time is greater than 2 hours 30 mins (150 mins)
        if (totalMinutes > 150) {
            const gndLabelInline = document.createElement('span');
            gndLabelInline.textContent = `GND TIME ${durStr}`;
            gndLabelInline.style.color = 'blue';
            textContainer.appendChild(gndLabelInline);
        }

        bar.appendChild(textContainer);

        chartArea.appendChild(bar);
    });

    container.appendChild(ganttContainer);
}
