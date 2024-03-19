"use strict";

/* global dumb bar. Goes away when the dumb dumbbar does. */

var gDumbBar;

/* global commit tree. */

var gCommitTree;

/* global commit selection. */

var gSelection = new CommitSelection();

/* JavaScript timestamp of last successful sync. */

var last_remote_mtime = 0;

/* FIXME: remove these globals. */

var gLastAttempt = Infinity;
var gTry = 1;
var tries = new Map();
var tick_interval;

/* Install the remote action procedures. */

install_remote_actions();

/* Main redisplay function */

async function redisplay()
{
    for (let commit of gCommitTree)
	delete commit.div;

    await gCommitTree.display();
}

/* Update the commit tree from the server. If `atomic` is specified,
 * don't apply local changes first, but assume the remote version is
 * better. */

async function update(atomic)
{
    if (!atomic) {
	while (gCommitTree && gCommitTree.dirty.size) {
	    for (let dirty of [...gCommitTree.dirty]) {
		try {
		    let json = await locked_fetch_json("/commit.json?orig_id=" + encodeURIComponent(JSON.stringify(dirty.orig_id)), {
			method: "POST",
			body: JSON.stringify(dirty),
		    });
		    if (json.success)
			dirty.dirty(false);
		} catch (e) {
		}
	    }
	}
    }
    let safely_before = new Date();
    let json = await locked_fetch_json("/commits.json?last_mtime=" + encodeURIComponent(+last_remote_mtime));
    if (gCommitTree) {
	gCommitTree.update(json);
    } else {
	gCommitTree = CommitTree.from_json(json);
    }
    last_remote_mtime = safely_before;
    gSelection = new CommitSelection();
    await gSelection.selection_changed();
}

/* Perform a single tick. */

async function action_tick()
{
    if (!gCommitTree)
	return;

    loop:
    while (true) {
	let candidates = [...gCommitTree];
	candidates = candidates.filter(x => !x.settled);
	candidates = candidates.sort((a, b) => (b.total_depth - a.total_depth) || (a.depth - b.depth));
	for (let candidate of candidates) {
	    let attempt = tries.get(JSON.stringify(candidate.orig_id)) || 0;
	    if (attempt < gTry) {
		let json = await candidate.moveup_1();
		if (!json.success)
		    tries.set(JSON.stringify(candidate.orig_id), attempt + 1);
		else
		    gDumbBar.log("👍");
		break loop;
	    }
	}
	if (gLastAttempt === document.getElementById("total-depth").innerText) {
	    gTry++;
	    await new Promise(r => setTimeout(r, 1000));
	} else {
	    gLastAttempt = document.getElementById("total-depth").innerText;
	    await find_global_action("update")();
	}
    }
}

/* Loop, trying to move commits up the tree so they have more siblings. */

async function action_loop()
{
    if (document.getElementById("loop").checked) {
	if (tick_interval === undefined) {
	} else {
	    tick_interval();
	    tick_interval = undefined;
	}
	tick_interval = () => tick_interval = undefined;
	while (tick_interval && document.getElementById("loop").checked) {
	    try {
		await action_tick();
	    } catch (e) {
		console.log("Exception, but continuing", e);
		await new Promise(r => setTimeout(r, 1000));
	    }
	}
	tick_interval();
	tick_interval = undefined;
    }
}

/* Trigger a remote export (two, actually). */

async function action_export()
{
    let resp = await locked_fetch("/export");
    let text = await resp.text();
    await update();
    await redisplay();
}

/* Trigger a remote import. */

async function action_import(raw)
{
    let resp = await locked_fetch("/import" + (raw ? "?raw=true" : ""));
    let json = await resp.json();
    await update();
    await redisplay();
}

window.onload = async function ()
{
    gDumbBar = new DumbBar();
    document.getElementById("loop").onclick = action_loop;
    document.getElementById("ui").addEventListener("keydown", async function (ev)  {
	if (ev.ctrlKey)
	    return;

	let action = find_action(ev.key);
	if (action) {
	    if (gSelection.length === 1) {
		let [commit] = gSelection;
		if (action in commit) {
		    gDumbBar.log(`performing ${action} on commit...`);
		    ev.preventDefault();
		    await update();
		    let resp = await commit[action]();
		    await update();
		    await redisplay();
		    gDumbBar.log(`done: ${JSON.stringify(resp)}`);
		    return;
		}
	    }
	    if (gSelection.length >= 1) {
		if (CommitSelection.prototype[action]) {
		    gDumbBar.log(`performing ${action} on ${gSelection.length} commits...`);
		    ev.preventDefault();
		    let resp = await gSelection[action]();
		    await update();
		    await redisplay();
		    gDumbBar.log(`done: ${JSON.stringify(resp)}`);
		    return;
		} else if (Commit.prototype[action]) {
		    ev.preventDefault();
		    gDumbBar.log(`performing ${action} on ${gSelection.length} commits...`);
		    let resp = [];
		    for (let commit of [...gSelection]) {
			resp.push(await commit[action]());
			await update();
			await redisplay();
		    }
		    gDumbBar.log(`done: ${JSON.stringify(resp)}`);
		    return;
		}
	    }
	    if (find_global_action(action)) {
		ev.preventDefault();
		gDumbBar.log(`performing global ${action}...`);
		let resp = await find_global_action(action)();
		gDumbBar.log(`done: ${JSON.stringify(resp)}`);
		return;
	    }
	}
	console.log(ev.key);
	console.log(ev);
    }, {
	capture: true,
    });
    document.getElementById("loop").checked = false;
    document.getElementById("ui").focus();
    await update();
    await redisplay();
};
