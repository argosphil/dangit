import { join } from "path";
import { tmpdir } from "os";
import { rmSync, writeFileSync, readFileSync, mkdirSync, openSync, close, closeSync, watch } from "fs";

/* Make globals global. */

globalThis.join = join;
globalThis.tmpdir = tmpdir;
globalThis.mkdirSync = mkdirSync;

/* I'm sorry.
 *
 * I wish I knew how to do this properly, but at present, I'd like
 * dangit.js to be plain old non-strict JavaScript suitable for
 * ingestion in old-fashioned web browsers. */

let text = await Bun.file("./dangit.js").text();
globalThis.eval(text);

/* Our initial, empty commit tree, usually overwritten by action_import. */

var gCommitTree = new CommitTree([]);

/* Import the repository specified on the command line, starting with
 * the commit specified on the command line.
 *
 * Defaults to four lines of unified diff context because that works. */

async function action_import(force_raw)
{
    let repo = process.argv[2];
    let base_commit = process.argv[3];
    if (!repo || !base_commit)
	return {
	    success: false,
	};

    let output = Bun.spawnSync(
	["git", "log", "-U4", "-p", "--no-renames", base_commit + "~1..HEAD"], {
	    stdio: [null, "pipe", null],
	    cwd: repo,
	}
    ).stdout.toString();

    let gitlog = new GitLog(output);
    gCommitTree = new CommitTree(gitlog.commits.map(Commit.from_gitlog_commit));
    /* Did we see any dangit metadata? If no, import as linear repository. */
    let raw = true;
    for (let i = 0; i < gCommitTree.sequence.length; i++) {
	let child = gCommitTree.sequence[i];
	if (!force_raw && child.dangit_metadata) {
	    raw = false;
	    for (let parent of child.dangit_metadata.parents) {
		let parent2 = gCommitTree.by_orig_id(parent[0]);
		if (parent2)
		    parent2.children.push(child);
		else
		    console.error("no", parent[0]);
	    }
	}
    }
    if (force_raw) {
	raw = true;
    }
    if (raw) {
	for (let i = 0; i < gCommitTree.sequence.length-1; i++) {
	    let parent = gCommitTree.sequence[i];
	    let child = gCommitTree.sequence[i+1];
	    parent.children.push(child);
	}
    } else {
	gCommitTree.queued_commits = gCommitTree.sequence.filter(x => !x.dangit_metadata);
    }

    gCommitTree.base_orig_id = base_commit;

    return {
	success: true,
    };
}

/* Export the current commit tree to two new branches, one which has
 * dangit_metadata and one which doesn't. Use the former to push over
 * "dangit-latest".
 *
 * Note that git must be configured not to deny pushes to the current
 * branch if you're actually on "dangit-latest".
 */

async function action_export()
{
    let base_commit = process.argv[3];
    await gCommitTree.export(base_commit, false, true);
    let {
	tree,
	name,
    } = await gCommitTree.export(base_commit, true, false);
    Bun.spawnSync(
	["git", "push", "-f", "origin", "HEAD:refs/heads/dangit-latest"], {
	    cwd: tree,
	    stdio: ["inherit", "inherit", "inherit"]
	}
    );
    return name;
}

/* Protected non-reentrant fetch function. */

async function fetch1(req) {
    let url = new URL(req.url);
    /* Static files. */
    if (url.pathname === "/index.html") {
	return new Response(Bun.file("dangit.html"), {headers: {"content-type": "text/html;charset=utf-8"}});
    }
    if (url.pathname === "/dangit.html") {
	return new Response(Bun.file("dangit.html"), {headers: {"content-type": "text/html;charset=utf-8"}});
    }
    if (url.pathname === "/dangit.css") {
	return new Response(Bun.file("dangit.css"), {headers: {"content-type": "text/css;charset=utf-8"}});
    }
    if (url.pathname === "/client.js") {
	return new Response(Bun.file("client.js"), {headers: {"content-type": "application/javascript"}});
    }
    if (url.pathname === "/dangit.js") {
	return new Response(Bun.file("dangit.js"), {headers: {"content-type": "application/javascript"}});
    }
    /* Trigger an import */
    if (url.pathname === "/import") {
	return new Response(JSON.stringify(await action_import(url.searchParams.get("raw"))));
    }
    /* Trigger an export */
    if (url.pathname === "/export") {
	let text = await action_export();
	return new Response(JSON.stringify(text));
    }
    /* Retrieve recently-modified commits. */
    if (url.pathname === "/commits.json") {
	let last_mtime = parseFloat(url.searchParams.get("last_mtime"));
	if (gCommitTree)
	    return new Response(JSON.stringify(last_mtime ? gCommitTree.after(last_mtime) : gCommitTree), {
		header: {
		    "content-type": "application/json",
		},
	    });
	return Response.json({});
    }
    /* Accept a commit uploaded by the client-side code. */
    if (url.pathname === "/commit.json") {
	let orig_id = JSON.parse(url.searchParams.get("orig_id"));
	let body = await req.json();
	let valid = true;
	if (gCommitTree) {
	    let commit = Commit.from_json(body, gCommitTree);
	    let old_commit = gCommitTree.by_orig_id(orig_id);
	    if ([...gCommitTree].indexOf(old_commit) === -1)
		old_commit = undefined;
	    if (!old_commit || +old_commit.mtime <= +commit.mtime) {
		commit.children.forEach(x => {
		    if (gCommitTree.by_orig_id(x) === undefined)
			valid = false;
		});
		if (valid) {
		    if (old_commit) {
			let index = gCommitTree.sequence.indexOf(old_commit);
			if (index !== -1)
			    gCommitTree.sequence.splice(index, 1, commit);
			else {
			    gCommitTree.sequence = gCommitTree.sequence.filter(x => JSON.stringify(x.orig_id) !== JSON.stringify(orig_id));
			    gCommitTree.sequence.push(commit);
			}
			for (let parent of old_commit.get_parents()) {
			    parent.children.splice(parent.children.indexOf(old_commit), 1, commit);
			}
		    } else {
			gCommitTree.sequence.push(commit);
		    }
		    commit.children = commit.children.map(c => gCommitTree.by_orig_id(c));
		    gCommitTree.map.delete(JSON.stringify(orig_id));
		    gCommitTree.map.set(JSON.stringify(orig_id), commit);
		}
	    }
	    return new Response(JSON.stringify({
		success: true,
	    }));
	}
	return new Response(JSON.stringify({
	    success: false,
	}));
    }
    /* Attempt to move up a commit. XXX make this an action. */
    if (url.pathname === "/action/moveup") {
	let orig_id = JSON.parse(url.searchParams.get("orig_id"));
	let commit = gCommitTree.by_orig_id(orig_id);
	let resp;
	if (!commit) {
	    resp = { success: false };
	} else {
	    resp = await commit.moveup(gCommitTree);
	}
	Bun.gc(true);
	return new Response(JSON.stringify(resp));
    }
    let m;
    if (m = url.pathname.match(/^\/action\/([a-z_]+)$/)) {
	let action = m[1];
	if (url.searchParams.get("orig_id")) {
	    let orig_id = JSON.parse(url.searchParams.get("orig_id"));
	    let commit = gCommitTree.by_orig_id(orig_id);
	    if (commit && commit[action]) {
		let resp = await commit[action]();
		Bun.gc(true); /* This is probably no longer required. */
		return new Response(JSON.stringify(resp));
	    }
	}
    }
    /* join two commits. */
    if (url.pathname === "/join") {
	let a = JSON.parse(url.searchParams.get("a"));
	let b = JSON.parse(url.searchParams.get("b"));
	let commit_a = gCommitTree.by_orig_id(a);
	let commit_b = gCommitTree.by_orig_id(b);
	let resp = {
	    success: false,
	};
	if (commit_a && commit_b)
	    resp = await commit_a.merge(commit_b);
	return new Response(JSON.stringify(resp));
    }
    /* prepare to quit */
    if (url.pathname === "/quit") {
	let resp = await action_quit();
	return new Response(JSON.stringify(resp));
    }
    return new Response(JSON.stringify("I don't know, dude"));
}

Bun.serve({
    async fetch(req) {
	let fetch_in_progress;
	while (fetch_in_progress)
	    await new Promise(r => setTimeout(r, 100));
	fetch_in_progress = true;
	try {
	    return await fetch1(req);
	} finally {
	    fetch_in_progress = false;
	}
    },
    port: 41753,
});

/* This is a hack. In case you hadn't noticed. */

watch("./dangit.js", () => process.exit(0));
