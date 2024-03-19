/* BIG FAT NOTICE:
 *
 * We rely on JSON.stringify returning a string predictably based on
 * the object, i.e. with no random permutation of
 * properties. Otherwise, things will break, starting with but not
 * limited to this function. */

function sort_key(a, b)
{
    return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
}

/* A dumb animated message bar, currently broken. */

function DumbBar(id = "dumbbar")
{
    this.div = document.getElementById(id);
    this.messages = [];
}

DumbBar.prototype.message = async function (div)
{
    div.style.display = "inline-block";
    this.messages.push(div);
    this.div.appendChild(div);
    await new Promise(r => requestAnimationFrame(r));
    let rect = this.div.getBoundingClientRect();
    let message_rect = div.getBoundingClientRect();
    while (this.messages.length > 1 || message_rect.x + message_rect.width > (rect.x + rect.width) / 2) {
	this.messages.shift().remove();
	if (this.messages.length === 0)
	    return;
	await new Promise(r => requestAnimationFrame(r));
	message_rect = div.getBoundingClientRect();
    }
    while (message_rect.x + message_rect.width > 0) {
	let left = parseInt(this.div.style.left.replace("px", ""));
	left--;
	this.div.style.left = `${left}px`;
	await new Promise(r => requestAnimationFrame(r));
	await new Promise(r => setTimeout(r, 16));
	message_rect = div.getBoundingClientRect();
	if (this.messages.length === 0)
	    return;
	if (this.messages[this.messages.length - 1] !== div)
	    return;
    }
};

DumbBar.prototype.log = async function (string)
{
    let span = document.createElement("span");
    span.innerText = string;
    await this.message(span);
};

/* A status light, to indicate whether a fetch() is currently in progress. */

function status_light_busy(busy = true, success)
{
    document.getElementById("status-light").innerHTML = "";
    if (success === true)
     	document.getElementById("status-light").appendChild(document.createTextNode("✓"));
    else if (success === false)
     	document.getElementById("status-light").appendChild(document.createTextNode("❌"));
    let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-10 -10 220 220");
    let circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", 100);
    circle.setAttribute("cy", 100);
    circle.setAttribute("r", 100);
    circle.setAttribute("stroke", "white");
    circle.setAttribute("stroke-width", "20");
    circle.setAttribute("fill", busy ? "#933" : "#393");
    svg.appendChild(circle);
    svg.style.width = "1em";
    svg.style.height = "1em";
    document.getElementById("status-light").appendChild(svg);
}

/* Locked fetch function, to avoid concurrent modifications. */

var fetch_locked = false;

async function locked_fetch(...args)
{
    while (fetch_locked)
	await new Promise(r => setTimeout(r, 100))
    fetch_locked = true;
    let ret;
    let success;
    try {
	status_light_busy(true, undefined);
	ret = await fetch(...args);
	if (ret) {
	    if (ret.success)
		success = true;
	    else
		success = false;
	}
	return ret;
    } finally {
	fetch_locked = false;
	status_light_busy(false, success);
    }
}

/* Same, but return parsed json. */

async function locked_fetch_json(...args)
{
    while (fetch_locked)
	await new Promise(r => setTimeout(r, 100))
    fetch_locked = true;
    let ret;
    let success;
    try {
	status_light_busy(true, undefined);
	ret = await fetch(...args);
	ret = await ret.json();
	if (ret) {
	    if (ret.success)
		success = true;
	    else
		success = false;
	}
	return ret;
    } finally {
	fetch_locked = false;
	status_light_busy(false, success);
    }
}

/* A short id tab abbreviating ids to their shortest unique prefix. */

function ShortIdTab()
{
    this.doms_by_long_id = new Map();
    this.short_id_by_long_id = new Map();
    this.ids_by_prefix = new Map();
    this.ids = new Set();
    this.registry = new FinalizationRegistry(long_id => this.maybe_expire(long_id));
}

ShortIdTab.prototype.set_short_id = function (long_id, short_id)
{
    let old_short_id = this.short_id_by_long_id.get(long_id);
    this.short_id_by_long_id.set(long_id, short_id);
    let doms = this.doms_by_long_id.get(long_id) || [];
    for (let weakref of doms) {
	let dom = weakref.deref();
	if (dom)
	    dom.update.call(dom, short_id);
    }
};

/* Add a new id. Internal, since you don't have a callback at this point. */

ShortIdTab.prototype.add_id = function (id)
{
    let invalidated_ids = new Set([id]);
    if (!this.ids_by_prefix.get(id) || !this.ids_by_prefix.get(id).has(id)) {
	for (let len = 0; len <= id.length; len++) {
	    let prefix = id.slice(0, len);
	    let set = this.ids_by_prefix.get(prefix) || new Set();
	    if (set.size === 1) {
		let [long_id] = set;
		invalidated_ids.add(long_id);
	    }
	    set.add(id);
	    this.ids_by_prefix.set(prefix, set);
	}
	let short_id = "";
	while (this.ids_by_prefix.get(short_id)?.size > 1 && short_id.length < id.length) {
	    short_id = id.slice(0, short_id.length + 1);
	}
	this.short_id_by_long_id.set(id, short_id);
	this.set_short_id(id, short_id);
    }
    for (let long_id of invalidated_ids) {
	let short_id = "";
	while (this.ids_by_prefix.get(short_id)?.size > 1 && short_id.length < long_id.length) {
	    short_id = long_id.slice(0, short_id.length + 1);
	}
	this.set_short_id(long_id, short_id);
    }
};

/* Remove an id. Internal as above. */

ShortIdTab.prototype.remove_id = function (id)
{
    if (!this.ids_by_prefix.get("").has(id))
	return;

    let invalidated_ids = new Set();
    for (let len = id.length; len >= 0; len--) {
	let prefix = id.slice(0, len);
	let set = this.ids_by_prefix.get(prefix);
	set.delete(id);
	if (set.size === 0)
	    this.ids_by_prefix.delete(prefix);
	else
	    this.ids_by_prefix.set(prefix, set);
	if (set.size === 1) {
	    for (let id of this.ids_by_prefix.get(prefix) || []) {
		invalidated_ids.add(id);
	    }
	}
    }
    this.short_id_by_long_id.delete(id);
    for (let long_id of invalidated_ids) {
	let short_id = "";
	while (this.ids_by_prefix.get(short_id)?.size > 1) {
	    short_id  = long_id.slice(0, short_id.length + 1);
	}
	this.set_short_id(long_id, short_id);
    }
};

/* Add a "dom" (actually, any object) whose callbacks will be called
 * when the short id corresponding to `long_id` changes, including
 * initially. */

ShortIdTab.prototype.add_dom = function (long_id, dom)
{
    let weakref = new WeakRef(dom);
    let doms = this.doms_by_long_id.get(long_id) || [];
    doms.push(weakref);
    this.doms_by_long_id.set(long_id, doms);
    this.add_id(long_id);
    this.registry.register(dom, long_id);
};

/* Maybe remove the id corresponding to long_id. */

ShortIdTab.prototype.maybe_expire = function (long_id)
{
    let doms = this.doms_by_long_id.get(long_id) || [];
    let new_doms = [];
    for (let dom of doms) {
	if (dom.deref() && dom.deref().isConnected)
	    new_doms.push(dom);
    }
    if (new_doms.length)
	this.doms_by_long_id.set(long_id, new_doms);
    else if (doms.length) {
	this.doms_by_long_id.delete(long_id);
	this.remove_id(long_id);
    }
};

/* A commit's "original id", which may be a simple SHA-1 hash, or a
 * complex object describing that this is part of a shattered commit
 * or a combination of commits. */

function OrigId(json)
{
    this.json = json;
}

OrigId.from_json = function (json)
{
    if (typeof json === "string") {
	return new OrigId(json);
    } else if (this === OrigId && "shard" in json) {
	return new OrigId.Shard(json);
    } else if (json instanceof Array) {
	return new OrigId.Sum(json);
    }
    return new this(json);
};

OrigId.prototype.toJSON = function ()
{
    return this.json;
};

OrigId.prototype.dom = function ()
{
    this.total_doms++;
    let dom = document.createElement("div");
    dom.style.display = "inline-block";
    this.prepare_dom(dom);
    return dom;
};

OrigId.prototype.prepare_dom = function (dom)
{
    dom.update = function (short_id) {
	this.innerHTML = "";
	this.innerText = short_id + "…";
    };
    let json = this.json;
    dom.destroy = function () {
	gShortIdTab.maybe_expire(json);
    };
    gShortIdTab.add_dom(this.json, dom);
};

function collapse_ranges(ranges)
{
    let ret = [];
    let r0, r1;
    while (ranges.length) {
	if (r0 === undefined) {
	    [r0, r1] = ranges.shift();
	} else if (ranges[0][0] > r1) {
	    ret.push([r0, r1]);
	    r0 = r1 = undefined;
	} else {
	    r1 = ranges.shift()[1];
	}
    }
    if (r0 !== undefined)
	ret.push([r0, r1]);
    return ret;
}

function merge_ranges(ranges_a, ranges_b)
{
    let ai = 0;
    let bi = 0;
    let ranges = [];
    while (true) {
	let ra = ranges_a[ai];
	let rb = ranges_b[bi];
	if (ra && rb) {
	    if (ra[0] < rb[0]) {
		ranges.push(ra);
		ai++;
	    } else {
		ranges.push(rb);
		bi++;
	    }
	} else if (ra) {
	    ranges.push(ra);
	    ai++;
	} else if (rb) {
	    ranges.push(rb);
	    bi++;
	} else {
	    return collapse_ranges(ranges);
	}
    }
}

OrigId.simplify = function (json)
{
    if (typeof json === "string")
	return json;

    if (json instanceof Array) {
	if (json.length === 1)
	    return OrigId.simplify(json[0]);
	json = json.slice();
	for (let json2 of json) {
	    if (json2 instanceof Array) {
		json.splice(json.indexOf(json2), 1, ...json2);
		return OrigId.simplify(json);
	    }
	}
	for (let json1 of json) {
	    for (let json2 of json) {
		if (json1 !== json2 &&
		    typeof json1 === "object" &&
		    typeof json2 === "object" &&
		    "shard" in json1 &&
		    "shard" in json2 &&
		    JSON.stringify(json1.shard) === JSON.stringify(json2.shard)) {
		    json.splice(json.indexOf(json1), 1, {shard: json1.shard, rs: merge_ranges(json1.rs, json2.rs), n: json1.n});
		    json.splice(json.indexOf(json2), 1);
		    return OrigId.simplify(json);
		}
	    }
	}
	return json.map(x => OrigId.simplify(x)).sort(sort_key);
    }

    if ("shard" in json) {
	if (json.rs[0][0] === 0 &&
	    json.rs[0][1] === json.n) {
	    return OrigId.simplify(json.shard);
	}
    }

    return json;
};

/* A shard: a subset of commits that another commit has been fractionated into. */

OrigId.Shard = function (json)
{
    OrigId.call(this, json);
};

OrigId.Shard.prototype = Object.create(OrigId.prototype);

/* Prepare a pizza slice icon for displaying a slice of a commit. */

OrigId.Shard.prototype.prepare_dom = function (dom)
{
    dom.append(OrigId.from_json(this.json.shard).dom());
    let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-10 -10 220 220");
    for (let r of this.json.rs) {
	let path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	let alpha0 = 2 * Math.PI * r[0] / this.json.n;
	let alpha1 = 2 * Math.PI * r[1] / this.json.n;
	let large = (r[1] - r[0] >= this.json.n/2) ? 1 : 0;
	path.setAttribute(
	    "d",
	    `M 100 100 L ${100 + 100 * Math.sin(alpha0)} ${100 - 100 * Math.cos(alpha0)} A 100 100 0 ${large} 1 ${100 + 100 * Math.sin(alpha1)} ${100 - 100 * Math.cos(alpha1)} Z`
	);
	path.setAttribute("stroke", "white");
	path.setAttribute("stroke-width", "20");
	path.setAttribute("fill", "white");
	svg.appendChild(path);
    }
    let circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", 100);
    circle.setAttribute("cy", 100);
    circle.setAttribute("r", 100);
    circle.setAttribute("stroke", "white");
    circle.setAttribute("stroke-width", "20");
    circle.setAttribute("fill", "none");
    svg.appendChild(circle);
    svg.style.width = "1em";
    svg.style.height = "1em";
    dom.append(svg);
};

/* A combination of independent commits. */

OrigId.Sum = function (json)
{
    OrigId.call(this, json);
};

OrigId.Sum.prototype = Object.create(OrigId.prototype);

OrigId.Sum.prototype.prepare_dom = function (dom)
{
    this.arr = this.json.map(x => OrigId.from_json(x).dom());
    for (let i = 0; i < this.arr.length; i++) {
	if (i !== 0)
	    dom.appendChild(document.createTextNode("+"));
	dom.appendChild(this.arr[i]);
    }
};

/* Produce the diff represented by the commit passed in as
 * argument. Currently hard-codes 4 context lines as that seemed good
 * in experiments to avoid ambiguous diffs. */

async function diff(repo, commitish_b) {
    let commitish_a = `${commitish_b}~1`;
    let key = JSON.stringify({diff: [commitish_a, commitish_b]});
    if (key in cache)
	return cache[key];
    let p = Bun.spawn(["git", "diff", "-U4", "--no-renames", commitish_a, commitish_b], {
	stdio: [ "ignore", "pipe", "inherit" ],
	cwd: repo,
    });
    let buf = new Buffer();
    for await (const chunk of p.stdout) {
	buf = Buffer.concat([buf, chunk]);
    }
    await p.exited;
    return cache[key] = buf.toString();
}

/* This code stolen from oven-sh/bun:runner.mjs. */

async function gen_tmpdir()
{
    var prevTmpdir = join(
	tmpdir(),
	"dangit-tmp-" + (Date.now() | 0).toString() + "_" + ((Math.random() * 100_000_0) | 0).toString(36),
    );
    mkdirSync(prevTmpdir, { recursive: true });
    return prevTmpdir;
}

/* A cache of temporary git work trees to be reused. */

let tmpdirs = [];

/* Check out a temporary tree for the commit, reusing existing git
 * work trees (not git worktrees, those are broken) if possible. */

async function tree_at(commitish)
{
    let tmpdir;
    if (tmpdirs.length) {
	tmpdir = tmpdirs.shift();
    } else {
	tmpdir = await gen_tmpdir();
	if (!process.argv[2])
	    process.exit(1);
	Bun.spawnSync(["git", "clone", "--shared", process.argv[2], "."], {
	    cwd: tmpdir,
	    stdio: [null, null, null],
	});
    }
    Bun.spawnSync(["git", "checkout", commitish], {
	cwd: tmpdir,
	stdio: [null, null, null],
    });
    return tmpdir;
}

/* Retire a temporary work tree. */

async function dontneed(tmpdir)
{
    Bun.spawnSync(["git", "reset", "--hard"], {
	cwd: tmpdir,
	stdio: ["inherit", "inherit", "inherit"],
    });
    Bun.spawnSync(["git", "clean", "-f", "-d", "-x"], {
	cwd: tmpdir,
	stdio: [null, null, null],
    });
    tmpdirs.push(tmpdir);
}

/* Prepare to quit, by removing existing workdirs. */

async function action_quit()
{
    await action_export();
    while (tmpdirs) {
	let tmpdir = tmpdirs.shift();
	Bun.spawnSync(["rm", "-r", tmpdir]);
    }
}

/* Determine whether `series`, which is an array of commits used to
 * specify their diffs, applies to `base`, a single commit used to
 * specify a tree. Return `false` if no conflict, an explanation of
 * the conflict otherwise. */

async function series_conflict([base, ...series])
{
    let dir = await base.checkout();
    try {
	for (let commit of series) {
	    if (commit.difftext) {
		let p = await Bun.spawn(["patch", "--quiet", "--no-backup-if-mismatch", "-F0", "-p1", "-N", "--force"], {
		    stdio: [ "pipe", "inherit", "inherit" ],
		    cwd: dir,
		});
		await p.stdin.write(commit.difftext + "\n");
		await p.stdin.end();
		let status = await p.exited;
		if (status !== 0) {
		    return {
			result: true,
			success: false,
			failed_at: commit.orig_id,
			in_series: [...series].map(x => x.orig_id),
			base: base.orig_id
		    };
		}
	    }
	}
	return false;
    } finally {
	await dontneed(dir);
    }
}

/* Display a commit tree, including its SVG part. */

CommitTree.prototype.display = async function ()
{
    if (!this.base)
	return;
    let svg = document.getElementById("svg");
    svg.innerHTML = "";
    let old_divs = new Set(document.getElementById("itree").childNodes);
    let divs = new Map();
    for (let commit of this) {
	if (commit.div) {
	    divs.set(commit, commit.div);
	    old_divs.delete(commit.div);
	}
    }
    let d = [];
    for (let el of document.getElementsByTagName("*")) {
	if (el.destroy)
	    d.push(el.destroy.bind(el));
    }
    // document.getElementById("itree").innerHTML = "";
    for (let destroy of d)
	destroy();
    this.base.descendants().map(x => {
	x.depth = undefined;
	x.total_depth = undefined;
    });
    for (let div of old_divs)
	div.remove();
    for (let commit of this)
	commit.divs = [];
    let { total_depth } = await this.base.display_recursive(divs);
    for (let [,div] of divs)
	div.remove();
    document.getElementById("total-depth").innerText = total_depth;
};

/* An individual "commit", which doesn't correspond to an actual git commit until exported. */

function Commit(commit_tree)
{
    this.children = [];
    this.commit_tree = commit_tree;
    this.tags = [];
    this.mtime = new Date();
    this.divs = [];
}

/* Create a commit from a gitlog commit `commit`, putting it into `commit_tree`. */

Commit.from_gitlog_commit = function (git_commit, commit_tree)
{
    let ret = new Commit(commit_tree);
    ret.orig_id = git_commit.id;
    ret.git_commit = git_commit;
    ret.diff = git_commit.diff;
    ret.difftext = git_commit.difftext;
    ret.commit_message = git_commit.commit_message;
    ret.dangit_metadata = git_commit.dangit_metadata;
    ret.commit_title = ret.commit_message.split("\n")[0];
    if (ret.dangit_metadata) {
	ret.orig_id = OrigId.simplify(ret.dangit_metadata.orig_id);
	ret.settled = ret.dangit_metadata.settled;
	ret.tags = ret.dangit_metadata.tags;
    }
    if (typeof ret.orig_id === "string" && ret.orig_id.match(/^[0-9a-f]+$/))
	ret.git_base_id = `${ret.orig_id}~1`;
    return ret;
};

/* Create a commit from `json`, using `commit_tree` as tree. */

Commit.from_json = function (json, commit_tree)
{
    let ret = new Commit(commit_tree);
    ret.orig_id = json.orig_id;
    ret.metadata = json.metadata;
    ret.commit_message = json.commit_message;
    ret.commit_title = ret.commit_message.split("\n")[0];
    ret.children = [...new Set(json.children)];
    ret.diff = json.diff;
    ret.difftext = json.difftext;
    ret.git_base_id = json.git_base_id;
    ret.selected = json.selected;
    ret.tags = json.tags || [];
    ret.original_json = JSON.stringify(json);
    ret.settled = json.settled;
    ret.mtime = json.mtime;
    return ret;
};

/* Since commits may refer to each other in an ultimately acyclic but
 * otherwise unpredictable fashion, we do a two-stage creation; first,
 * .children holds an array of original IDs in JSON format. Then, when
 * all commits have been installed in a tree, .children is replaced by
 * an array of references to the actual child commits. */

Commit.prototype.resolve_children = function ()
{
    let orig_ids = this.children;
    this.children = [];
    for (let orig_id of orig_ids) {
	let child = this.commit_tree.by_orig_id(orig_id);
	if (!child) {
	    console.error("couldn't find child", orig_id);
	} else {
	    this.children.push(child);
	}
    }
};

/* Convert to JSON: children are replaced by their orig_ids, no
 * reference to the tree remains, and the mtime is stored as a
 * float. */

Commit.prototype.toJSON = function ()
{
    let {
	children,
	commit_message,
	commit_title,
	diff,
	difftext,
	git_base_id,
	metadata,
	mtime,
	orig_id,
	selected,
	settled,
	tags,
    } = this;
    children = children.map(c => {
	if (c === undefined) {
	    console.error("undefined child in", this.orig_id);
	}
	return c.orig_id;
    });
    mtime = +mtime;
    return {
	children,
	commit_message,
	commit_title,
	diff,
	difftext,
	git_base_id,
	metadata,
	mtime,
	orig_id,
	selected,
	settled,
	tags,
    };
};

/* Highlight this commit in `color`. */

Commit.prototype.highlight = function (color)
{
    this.highlight_color = color;
};

Commit.prototype.dirty = function (dirtied = true)
{
    if (dirtied) {
	this.dirtied = true;
	this.mtime = new Date();
	this.commit_tree.dirty.add(this);
    } else {
	delete this.dirtied;
	this.commit_tree.dirty.delete(this);
    }
};

Commit.prototype.select = function (selected = true)
{
    if (selected && !this.selected) {
	this.selected = true;
	this.dirty();
    } else if (!selected && this.selected) {
	delete this.selected;
	this.dirty();
    }
    if (this.div)
	this.div.parts.cb.checked = this.selected;
};

/* Delete a commit, replacing it by `replacements` (in the sequence) and `replacement_children` in the tree. */

Commit.prototype.delete = function (replacements = [], replacement_children = [])
{
    this.mtime = new Date();
    if (this.selected)
	for (let commit of replacements) {
	    commit.select();
	    commit.dirty();
	}
    this.select(false);
    this.commit_tree.deleted_commits.add(this);
    this.commit_tree.map.delete(JSON.stringify(this.orig_id));
    if (this.commit_tree.sequence.indexOf(this) !== -1)
	this.commit_tree.sequence.splice(this.commit_tree.sequence.indexOf(this), 1, ...replacements);
    this.dirty();
    for (let parent of this.get_parents()) {
	parent.children.splice(parent.children.indexOf(this), 1, ...replacement_children);
	parent.dirty();
    }
};

/* Find the set of descendants of this commit. */

Commit.prototype.descendants = function (set = new Set())
{
    if (set.has(this))
	return [];

    set.add(this);

    for (let child of this.children) {
	child.descendants(set);
    }

    return [...set];
};

/* Create a DOM node representing this commit. */

Commit.prototype.create_div = function (depth)
{
    let div = document.createElement("div");
    this.div = div;
    this.divs.push(div);
    div.style.display = "block";
    for (let div of this.divs)
	div.style.left = `${depth+1}em`;
    div.style.position = "relative";
    div.parts = {};
    div.addEventListener("click", ev => {
	ev.preventDefault();
	div.parts.cb.onclick(ev);
    });
    {
	let cb = document.createElement("input");
        cb.type = "checkbox";
	cb.style.filter = "invert(100%) grayscale(100%)";
	cb.checked = this.selected;
	cb.setAttribute("tabindex", "-1");
	div.cb = cb;
	cb.onclick = async (ev) => {
	    ev.preventDefault();
	    if (!cb.checked && !ev.shiftKey) {
		for (let commit of gSelection)
		    commit.select(false);
	    }
	    this.select(!cb.checked);
	    await update();
	    await redisplay();
	};
	div.parts.cb = cb;
	div.appendChild(cb);
    }
    {
	let box = document.createElement("span");
	for (let tag of this.tags) {
	    let span = document.createElement("span");
	    span.innerText = "(" + tag + ")"
	    span.style.color = "#393";
	    span.style.fontWeight = "bold";
	    box.appendChild(span);
	}
	{
	    let span = document.createElement("span");
	    this.orig_id_object = OrigId.from_json(this.orig_id);
	    span.appendChild(OrigId.from_json(this.orig_id).dom());
	    let pre = document.createElement("pre");
	    pre.style.display = "inline-block";
	    if (this.highlight_color)
		pre.style.background = this.highlight_color;
	    let text = " ";
	    let tn = document.createTextNode(text);
	    pre.appendChild(tn);
	    span.appendChild(pre);
	    box.appendChild(span);
	}
	{
	    let pre = document.createElement("pre");
	    pre.style.display = "inline-block";
	    if (this.highlight_color)
		pre.style.background = this.highlight_color;
	    let text = this.commit_title;
	    let tn = document.createTextNode(text);
	    pre.appendChild(tn);
	    box.appendChild(pre);
	}
	{
	    let difftext = this.difftext;
	    let lines = difftext.split("\n");
	    let filenames = new Map();
	    for (let line of lines) {
		let m = line.match(/^(---|\+\+\+) [ab]\/(.*)$/);
		if (m) {
		    let file = m[2];
		    let filename = [...m[2].split("/")].pop();
		    let fragments = [...filename.split(".")];
		    let extension = "";
		    if (fragments.length >= 2) {
			extension = "." + fragments.pop();
			filename = fragments.join(".");
		    } else {
		    }
		    filenames.set(filename, [extension]);
		}
	    }
	    for (let [filename, [extension]] of filenames) {
		let dom = document.createElement("span");
		dom.update = function (short_id) {
		    this.innerHTML = "";
		    let ellipsis = "";
		    if (short_id.length < filename.length)
			ellipsis = "…";
		    this.innerText = short_id + ellipsis + extension;
		};
		dom.destroy = function () {
		    gShortIdTabFilename.maybe_expire(filename);
		};
		gShortIdTabFilename.add_dom(filename, dom);
		dom.style.border = "1px solid white";
		dom.style.fontSize = "smaller";
		box.appendChild(dom);
	    }
	    lines = lines.filter(x => x.match(/^diff /));
	    if (lines.length !== 1) {
		let span = document.createElement("span");
		span.innerText = "[" + lines.length + "]"
		span.style.color = "#66f";
		span.style.fontWeight = "bold";
		box.appendChild(span);
	    }
	}
	{
	    let difftext = this.difftext;
	    let lines = difftext.split("\n");
	    lines = lines.filter(x => x.match(/^diff/));
	    if (lines.length !== 1) {
		let span = document.createElement("span");
		span.innerText = "[" + lines.length + "]"
		span.style.color = "#66f";
		span.style.fontWeight = "bold";
		box.appendChild(span);
	    }
	}
	{
	    let difftext = this.difftext;
	    let lines = difftext.split("\n");
	    lines = lines.filter(x => x.match(/^@@/));
	    if (lines.length !== 1) {
		let span = document.createElement("span");
		span.innerText = "{" + lines.length + "}"
		span.style.color = "#66f";
		box.appendChild(span);
	    }
	}
	div.parts.box = box;
	div.appendChild(box);
    }
    return div;
}

/* Display the metadata pane for this commit. */

Commit.prototype.display_metadata = async function ()
{
    let metadata = {
	...this,
    };
    delete metadata.children;
    delete metadata.commit_tree;
    delete metadata.diff;
    delete metadata.difftext;
    delete metadata.dirtied;
    delete metadata.display_id;
    delete metadata.div;
    delete metadata.git_commit;
    delete metadata.highlight_color;
    delete metadata.orig_id_object;
    delete metadata.original_json;
    delete metadata.selected;
    delete metadata.total_depth;
    document.getElementById("metadata").innerHTML = "";
    if (this.commit_message) {
	let comment = this.commit_message;
	while (comment.length && comment[comment.length-1] === "\n")
	    comment = comment.slice(0, comment.length - 1);
	let comment_pre = document.createElement("pre");
	comment_pre.id = "commit_title";
	comment_pre.style.width = "100%";
	comment_pre.style.height = "fit-content";
	comment_pre.innerText = comment;
	comment_pre.onfocus = () => {
	};
	comment_pre.onblur = async () => {
	    this.commit_message = comment_pre.innerText
	    this.commit_title = this.commit_message;
	    this.dirty();
	    await update();
	    await redisplay();
	    document.getElementById("ui").focus();
	};
	comment_pre.contentEditable = true;
	document.getElementById("metadata").appendChild(document.createElement("hr"));
	document.getElementById("metadata").appendChild(comment_pre);
	document.getElementById("metadata").appendChild(document.createElement("hr"));
	delete metadata.commit_message;
	delete metadata.commit_title;
    }
    document.getElementById("heading-metadata").innerHTML = "Metadata";
    document.getElementById("buttons-metadata").innerHTML = "";
    let button = document.createElement("button");
    button.innerText = "Shatter";
    button.onclick = async () => {
	await shatter_id(this.orig_id);
	await update();
	await redisplay();
	await action_startover();
    };
    document.getElementById("buttons-metadata").appendChild(button);
    let pre = document.createElement("pre");
    pre.innerText = JSON.stringify(metadata, undefined, 4);
    document.getElementById("metadata").appendChild(pre);
};

/* Display the difftext pane for this commit. */

Commit.prototype.display_difftext = async function ()
{
    let div = document.createElement("div");
    for (let line of this.difftext.split("\n")) {
	let pre = document.createElement("pre");
	pre.innerText = line;
	div.appendChild(pre);
	if (line.match(/^ /)) {
	    /* XXX detect actual lines with ++ or -- being added/removed. */
	} else if (line.match(/^(@|\+\+\+|---)/)) {
	    pre.style.fontWeight = "bold";
	} else if (line.match(/^\+/)) {
	    pre.style.background = "#353";
	} else if (line.match(/^-/)) {
	    pre.style.background = "#533";
	}
    }
    document.getElementById("diff").innerHTML = "";
    document.getElementById("diff").appendChild(div);
};

/* Display this commit, below all of its children. */

Commit.prototype.display_recursive = async function (map = new Map(), {depth} = {depth: 0})
{
    if ((this.depth || -1) < depth)
	this.depth = depth;
    let total_depth = this.depth;
    let cbs = [];
    for (let child of this.children) {
	let o = await child.display_recursive(map, {
	    depth: depth + ((child.get_parents().length > 1) ? 2 : 1),
	});
	total_depth += o.total_depth;
	cbs.push(o.div.cb);
    }
    let div;
    if (map.has(this)) {
	div = map.get(this);
	map.delete(this);
    } else {
	div = this.create_div(this.depth);
    }
    document.getElementById("itree").appendChild(div);
    let cb = div.cb;
    let svg = document.getElementById("svg");
    let rect = svg.getBoundingClientRect();
    let oldpos = cb.getBoundingClientRect();
    oldpos.x -= rect.x;
    oldpos.y -= rect.y;
    oldpos.x += oldpos.width / 2;
    oldpos.y += oldpos.height / 2;
    for (let ccb of cbs) {
	let newpos = ccb.getBoundingClientRect();
	newpos.x -= rect.x;
	newpos.y -= rect.y;
	newpos.x += newpos.width / 2;
	newpos.y += newpos.height / 2;
    	let spline = document.createElementNS("http://www.w3.org/2000/svg", "path");
	spline.setAttribute("d", `M ${oldpos.x} ${oldpos.y} T ${oldpos.x} ${.5 * oldpos.y + .5 * newpos.y} T ${.5 * oldpos.x + .5 * newpos.x} ${newpos.y} T ${newpos.x} ${newpos.y}`);
	spline.setAttribute("stroke", "white");
	spline.setAttribute("stroke-width", "3px");
	spline.setAttribute("fill", "none");
	svg.appendChild(spline);
    }
    this.total_depth = total_depth;
    return {
	div,
	total_depth,
    };
};

/* Get all parents for this commit. */

Commit.prototype.get_parents = function ()
{
    let parents = [];
    for (let candidate of this.commit_tree.sequence) {
	if (candidate.children.indexOf(this) !== -1)
	    parents.push(candidate);
    }
    return parents;
};

/* Generate the first series that goes through this commit, but exclude commits in `exclude`. */

Commit.prototype.generate_first_series = function (exclude = [])
{
    if (exclude.indexOf(this) !== -1)
	return [];
    let ret = [this];
    child:
    for (let child of this.children) {
	for (let parent of child.get_parents()) {
	    if (ret.indexOf(parent) === -1)
		continue child;
	}
	ret.push(...child.generate_first_series(exclude));
    }
    return ret;
};

/* Verify this commit didn't break anything. */

Commit.prototype.verify_1 = async function ()
{
    let child = this;
    let [parent] = this.get_parents();
    if (!parent)
	return { success: false };
    let [pparent] = parent.get_parents();
    if (!pparent)
	return { success: false };
    let series_c = [];
    series_c.push(parent);
    series_c.push(...parent.generate_first_series());
    let p_c = await series_conflict(series_c);
    if (await p_c)
	return await p_c;
    return { success: true };
}

/* Apply this commit recursively. */

Commit.prototype.apply_recursive = async function (tree, set_base_id = false, remove_metadata = false)
{
    await this.apply(tree, set_base_id, remove_metadata);
    for (let child of this.children) {
	await child.apply_recursive(tree, set_base_id, remove_metadata);
    }
};

/* "s": shatter a commit, producing one new commit per hunk. */

Commit.prototype.shatter = async function ()
{
    let parents = this.get_parents();
    if (!parents[0])
	return {
	    success: false,
	    reason: "orphaned",
	};

    let difftext = this.difftext;
    let diff = new GitLog.Diff(difftext.split("\n"));
    let hunks = diff.hunks;
    let n = hunks.length;
    if (n <= 1)
	return {
	    success: false,
	    message: "single hunk only",
	};
    let i = 1;
    let new_commits = [];
    let children = this.children;
    for (let hunk of hunks) {
	let new_commit = Commit.from_json(this.toJSON(), this.commit_tree);
	new_commit.dirty();
	new_commit.children = children.slice();
	new_commit.difftext = hunk.join("\n") + "\n";
	new_commit.orig_id = {
	    shard: new_commit.orig_id,
	    rs: [[i-1, i]],
	    n
	};
	new_commit.commit_tree = this.commit_tree;
	new_commit.settle(false);
	new_commit.dirty();
	if (i !== 1)
	    delete new_commit.git_base_id;
	i++;
	new_commits.push(new_commit);
    }
    if (new_commits.length === 0) {
	return {
	    success: false,
	    reason: "hunks disappeared",
	};
    }
    for (let child of children)
	child.settle(false);
    for (let i = 0; i < new_commits.length - 1; i++) {
	new_commits[i].children = [new_commits[i+1]];
    }
    for (let commit of new_commits) {
	this.commit_tree.map.set(JSON.stringify(commit.orig_id), commit);
    }
    this.delete(new_commits, [new_commits[0]]);

    return {
	success: true,
    };
};

function path_to(t, parents)
{
    let base = t.by_orig_id(t.base_orig_id);
    let path = base.generate_first_series(parents);

    for (let parent of parents) {
	let remaining_parents = parents.slice();
	remaining_parents.splice(remaining_parents.indexOf(parent), 1);
	let ppath = base.generate_first_series(remaining_parents);
	for (let commit of ppath) {
	    if (path.indexOf(commit) === -1) {
		path.push(commit);
	    }
	}
    }

    return path;
}

/* Check out the tree before this commit is applied. */

Commit.prototype.checkout_before = async function ()
{
    if (this.git_base_id) {
	let tree = await tree_at(this.git_base_id);
	return tree;
    }
    let trees = [];
    for (let parent of this.get_parents()) {
	let tree = await parent.checkout();
	trees.push(tree);
    }
    if (trees.length === 1)
	return trees[0];
    let tree = await tree_at(this.base_orig_id);
    for (let t of trees) {
	Bun.spawnSync(["git", "remote", "add", "t", t], {
	    cwd: tree,
	});
	Bun.spawnSync(["git", "branch", "-b", "t"], {
	    cwd: t,
	});
	Bun.spawnSync(["git", "pull", "t", "t"], {
	    cwd: tree,
	});
	Bun.spawnSync(["git", "remote", "remove", "t"], {
	    cwd: tree,
	});
    }
    return tree;
};

/* Check out the tree after this commit has been applied. */

Commit.prototype.checkout = async function ()
{
    let tree = await this.checkout_before();
    await this.apply(tree);
    return tree;
};

/* A tree, or DAG, or DAN, of "commits" as described above. */

function CommitTree(commits, dontset)
{
    this.map = new Map();
    this.sequence = [];
    this.queued_commits = [];
    this.dirty = new Set();
    for (let commit of commits) {
	if (!dontset)
	    commit.commit_tree = this;
	this.sequence.push(commit);
	this.map.set(JSON.stringify(commit.orig_id), commit);
    }
    this.deleted_commits = new Set();
}

/* Partial update of a commit tree from JSON data. */

CommitTree.prototype.update = function (json)
{
    for (let orig_id of json.sequence) {
	let key = JSON.stringify(orig_id);
	if (key in json.map) {
	    let existing = this.map.get(key);
	    let commit = Commit.from_json(json.map[key], this);
	    if (existing) {
		if (+commit.mtime < +existing.mtime) {
		    delete json.map[key];
		    continue;
		}
		for (let parent of existing.get_parents()) {
		    parent.children.splice(parent.children.indexOf(existing), 1, commit);
		}
	    }
	    this.map.delete(key);
	    this.map.set(key, commit);
	}
    }
    this.sequence = json.sequence.map(x => {
 	let commit = this.map.get(JSON.stringify(x));
	return commit;
    });
    this.base = this.by_orig_id(this.base_orig_id);
    for (let orig_id of json.sequence) {
	let key = JSON.stringify(orig_id);
	if (key in json.map) {
	    this.by_orig_id(orig_id).resolve_children();
	}
    }
    for (let orig_id of json.deleted_commits) {
	let commit = this.by_orig_id(orig_id);
	if (commit)
	    commit.delete();
    }
};

/* Restore an entire commit tree from its JSON representation. Except, not quite, see resolve_children. */

CommitTree.from_json = function (json)
{
    let commits = new Map();
    for (let orig_id of json.sequence) {
	commits.set(JSON.stringify(orig_id), Commit.from_json(json.map[JSON.stringify(orig_id)]));
    }
    for (let commit of commits.values()) {
	/* XXX use resolve_children */
	commit.children = commit.children.map(orig_id => {
	    let v = commits.get(JSON.stringify(orig_id));
	    return v;
	});
    }
    let ret = new CommitTree([...commits.values()]);
    ret.base_orig_id = json.base_orig_id;
    ret.base = ret.map.get(JSON.stringify(ret.base_orig_id));
    ret.deleted_commits = new Set(json.deleted_commits.map(orig_id => ret.map.get(JSON.stringify(orig_id))).filter(x => x));
    ret.queued_commits = [...new Set(json.queued_commits.map(orig_id => ret.map.get(JSON.stringify(orig_id))).filter(x => x))];

    for (let commit of ret.map.values()) {
	commit.commit_tree = ret;
    }

    return ret;
};

/* Flatten sequence, retain base_orig_id, deleted_commits, put map into .map. */

CommitTree.prototype.toJSON = function ()
{
    let sequence = this.sequence.map(x => x.orig_id);
    let map = {};
    let {
	base_orig_id,
	deleted_commits,
	queued_commits,
    } = this;
    deleted_commits = [...deleted_commits].map(x => x.orig_id);
    queued_commits = [...queued_commits].map(x => x.orig_id);
    for (let [orig_id, commit] of this.map) {
	if (this.sequence.indexOf(commit) !== -1)
	    map[orig_id] = commit;
    }
    return {
	base_orig_id,
	deleted_commits,
	map,
	queued_commits,
	sequence,
    };
};

/* Find a commit by its `orig_id`, a JSON object. */

CommitTree.prototype.by_orig_id = function (orig_id)
{
    return this.map.get(JSON.stringify(orig_id));
};

/* We're iterable, and delegate to this.sequence. */

CommitTree.prototype[Symbol.iterator] = function* ()
{
    for (let x of this.sequence)
	yield x;
};

/* Slice of `this` which changed after `mtime`. */

CommitTree.prototype.after = function (mtime)
{
    let ret = new CommitTree(this.sequence.filter(x => +x.mtime >= +mtime), true);
    ret.sequence = this.sequence.slice();
    ret.base_orig_id = this.base_orig_id;
    return ret;
};

/* Export this commit, optionally being instructed to `set_base_id` or `remove_metadata`. */

CommitTree.prototype.export = async function (base_commit, set_base_id = false, remove_metadata = false)
{
    let tree = await tree_at(base_commit);
    for (let child of this.by_orig_id(this.base_orig_id).children) {
	await child.apply_recursive(tree, set_base_id, remove_metadata);
    }
    let date = (new Date()).toISOString().replace(/:/g, "");
    let name = "dangit-" + (remove_metadata ? "no-metadata-" : "") + date;
    Bun.spawnSync(
	["git", "push", "origin", "HEAD:refs/heads/" + name], {
	    cwd: tree,
	    stdio: ["inherit", "inherit", "inherit"]
	}
    );

    return {
	tree,
	name,
    };
};

/* A git log, i.e. the output of "git log -p", parsed and prepared for turning into Commit objects. */

function GitLog(text)
{
    this.commits = [];
    for (const commit_text of text.split(/^(?=commit)/mg).reverse()) {
	this.commits.push(new GitLog.Commit(commit_text));
    }
}

/* Find a commit in a git log. */

GitLog.prototype.commit = function (id)
{
    for (let commit of this.commits)
	if (commit.id && commit.id.startsWith(id))
	    return commit;
};

/* An individual diff (a single file's changes in a single commit) in a git log. */

GitLog.Diff = function (lines)
{
    this.hunks = [];
    let file = [];
    let hunk = [];
    let flush_hunk = () => {
	if (hunk.length)
	    this.hunks.push([...file, ...hunk]);
	hunk = [];
    };
    let flush_file = () => {
	flush_hunk();
	file = [];
    };
    let flush_diff = () => {
	flush_file();
    };
    for (const line of lines) {
	let m;
	if (line.match(/^diff/)) {
	    flush_diff();
	    file.push(line);
	} else if (line.match(/^(---|\+\+\+|index |new file |deleted file )/)) {
	    /* XXX handle removal of lines starting with "--" etc. */
	    file.push(line);
	} else if (line.match(/^@@/)) {
	    flush_hunk();
	    hunk.push(line);
	} else {
	    hunk.push(line);
	}
    }
    flush_diff();
};

/* An individual commit in a git log. */

GitLog.Commit = function (text)
{
    let lines = text.split("\n");
    this.headers = {};
    this.commit_message = "";
    let mode = "commit";
    let diff_lines = [];
    for (const line of lines) {
	let m;
	if (m = line.match(/^commit (.*)$/)) {
	    this.id = m[1];
	}
	if (m = line.match(/^([A-Za-z]+)[ \t]*:[ \t]*(.*?)$/)) {
	    this.headers[m[1]] = m[2];
	}
	if (mode === "commit") {
	    if (m = line.match(/^    (.*)$/)) {
		let m2;
		if (m2 = line.match(/^    dangit:\{(.*)\}$/)) {
		    try {
			this.dangit_metadata = JSON.parse(`{${m2[1]}}`);
		    } catch (e) {
			console.error("couldn't parse", m2[1]);
		    }
		} else {
		    this.commit_message += m[1] + "\n";
		}
	    }
	    if (m = line.match(/^diff/)) {
		diff_lines.push(line);
		mode = "diff";
	    }
	} else if (mode === "diff") {
	    diff_lines.push(line);
	}
    }
    this.diff = new GitLog.Diff(diff_lines);
    this.difftext = diff_lines.join("\n");
};

/* Apply this gitlog commit to `repo`, optionally being instructed to `set_base_id`. */

GitLog.Commit.prototype.apply = async function (repo, set_base_id)
{
    if (set_base_id) {
	let p = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
	    cwd: repo,
	    stdio: [null, "pipe", "inherit"]
	});
	this.git_base_id = p.stdout.toString().trim().replace(/\n/g, "");
    }
    {
	let p = await Bun.spawn(["patch", "--quiet", "--no-backup-if-mismatch", "-p1", "-N", "-F0"], {
	    stdio: ["pipe", "inherit", "inherit"],
	    cwd: repo,
	});
	for (let hunk of this.diff.hunks) {
	    for (let line of hunk) {
		await p.stdin.write(line + "\n");
	    }
	}
	await p.stdin.end();
	let ret = await p.exited;
    }
    {
	let p = await Bun.spawn(["git", "add", "--all"], {
	    cwd: repo,
	});
	await p.exited;
    }
    {
	let p = await Bun.spawn(["git", "commit", "--allow-empty", "-a", "-m", this.commit_message, "--author=" + this.headers.Author], {
	    cwd: repo,
	});
	await p.exited;
    }
};

/* Apply this commit to `tree`, optionally being instructed to `set_base_id` or `remove_metadata`. */

Commit.prototype.apply = async function (tree, set_base_id, remove_metadata)
{
    if (set_base_id) {
	let p = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
	    stdio: [null, "pipe", "inherit"],
	    cwd: tree,
	});
	this.git_base_id = p.stdout.toString().trim().replace(/\n/g, "");
	this.dirty();
    }
    {
	let p = await Bun.spawn(["patch", "--quiet", "--force", "--no-backup-if-mismatch", "-p1", "-N", "-F0"], {
	    stdio: ["pipe", "inherit", "inherit"],
	    cwd: tree,
	});
	p.stdin.write(this.difftext);
	await p.stdin.end();
	let ret = await p.exited;
    }
    {
	let p = await Bun.spawn(["git", "add", "--all"], {
	    cwd: tree,
	});
	let ret = await p.exited;
    }
    let {
	git_base_id,
	git_commit,
	mtime,
	orig_id,
	selected,
	settled,
	tags,
    } = this;
    let metadata = {
	git_base_id,
	git_commit,
	mtime,
	orig_id,
	selected,
	settled,
	tags,
    };

    metadata.parents = this.get_parents().map(parent => [parent.orig_id]);
    this.metadata_string = "dangit:" + JSON.stringify(metadata) + "\n";
    {
	let default_author = process.env["DANGIT_AUTHOR"];
	if (!default_author)
	    process.exit(1);
	let author = default_author;
	if (this.headers && this.headers.Author)
	    author = this.headers.Author;
	let p = await Bun.spawn(["git", "commit", "--allow-empty", "-a", "-m", this.commit_message + (remove_metadata ? "" : ("\n\n" + this.metadata_string)), "--author=" + author], {
	    cwd: tree,
	    stdio: ["inherit", "inherit", "inherit"]
	});
	await p.exited;
    }
};

/* "r": reassign this commit, giving it a new simple orig_id. */

Commit.prototype.reassign = async function ()
{
    let tree = await this.checkout_before();
    await this.apply(tree);
    let p = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
	    cwd: tree,
	    stdio: ["inherit", "pipe", "inherit"]
    });
    let commit = Commit.from_json(this.toJSON(), this.commit_tree);
    commit.resolve_children();
    commit.orig_id = p.stdout.toString().trim().replace(/\n/g, "");
    this.delete([commit], [commit]);
    commit.dirty();
    this.commit_tree.map.set(JSON.stringify(commit.orig_id), commit);
    await dontneed(tree);
    return {
	success: true,
	map: {
	    key: this.orig_id,
	},
    };
};

/* "e": edit the commit message. Doesn't work. */

Commit.prototype.edit = async function ()
{
    document.getElementById("commit_title").focus();
};

/* "m": attempt to move a commit up the tree, simplifying it. */

Commit.prototype.moveup_1 = async function ()
{
    await update();
    let candidate = this;
    if (document.getElementById("follow").checked && candidate.div)
	candidate.div.cb.scrollIntoView({ block: "center", inline: "center", });
    candidate.highlight("#933");
    gOneSuggestion = candidate;
    await redisplay();
    await update();

    let json = await locked_fetch_json("/action/moveup?orig_id=" + encodeURIComponent(JSON.stringify(candidate.orig_id)));
    /* This is where our timestamp-based approach breaks down. If the
     * moveup is effective, we must not dirty anything but call
     * update() right away. Fudge it for now. */
    await update("atomic");
    if (!json.success) {
	this.settle();
    } else {
	this.settle(false);
	for (let parent of this.get_parents()) {
	    parent.settle(false);
	    for (let child of parent.children)
		child.settle(false);
	    for (let child of this.children)
		child.settle(false);
	}
    }
    candidate.highlight(undefined);
    await update();
    if (json.failed_at) {
	// gCommitTree.by_orig_id(json.failed_at).highlight("#77f");
	gOneSuggestionWhy = gCommitTree.by_orig_id(json.failed_at);
    }
    await redisplay();
    return json;
};

/* Merge precisely two commits. */

Commit.prototype.merge = async function (other)
{
    if (this === other)
	return {
	    success: false,
	};

    if (this.children.indexOf(other) !== -1) {
	let commit = new Commit(this.commit_tree);
	commit.orig_id = OrigId.simplify([this.orig_id, other.orig_id].sort(sort_key));
	commit.difftext = this.difftext + "\n" + other.difftext;
	if (this.commit_message === other.commit_message) {
	    commit.commit_message = this.commit_message;
	    commit.commit_title = this.commit_title;
	} else {
	    commit.commit_message = this.commit_message + other.commit_message;
	    commit.commit_title = "combined commit";
	}
	commit.commit_tree = this.commit_tree;
	commit.children = [...this.children];
	commit.children.splice(commit.children.indexOf(other), 1, ...other.children);
	this.delete([commit], [commit]);
	other.delete([], []);
	this.commit_tree.map.set(JSON.stringify(commit.orig_id), commit);
	commit.select(true);
	commit.dirty();
	return {
	    success: true,
	};
    }

    let [parent] = this.get_parents();
    if (parent && parent.children.indexOf(this) !== -1 && parent.children.indexOf(other) !== -1) {
	let commit = new Commit(this.commit_tree);
	commit.orig_id = OrigId.simplify([this.orig_id, other.orig_id].sort(sort_key));
	commit.difftext = this.difftext + "\n" + other.difftext;
	if (this.commit_message === other.commit_message) {
	    commit.commit_message = this.commit_message;
	    commit.commit_title = this.commit_title;
	} else {
	    commit.commit_message = "combined commit\n\n" + this.commit_message + other.commit_message;
	    commit.commit_title = "combined commit";
	}
	commit.commit_tree = this.commit_tree;
	commit.children = [...this.children, ...other.children];
	this.commit_tree.map.set(JSON.stringify(commit.orig_id), commit);
	this.commit_tree.sequence.push(commit);
	this.delete([commit], [commit]);
	other.delete([], []);
	commit.select(true);
	commit.dirty();
	return {
	    success: true,
	};
    }

    if (other.children.indexOf(this) !== -1)
	return other.merge(this);

    return {
	success: false,
    };
};

/* "i": isolate a commit, making its siblings depend on it. */

Commit.prototype.isolate = async function (other)
{
    let new_children = new Set();
    for (let parent of this.get_parents()) {
	for (let child of parent.children) {
	    if (child !== this)
		new_children.add(child);
	}
	parent.children = [this];
    }
    this.children.push(...new_children);

    return {
	success: true,
    };
};

/* "d": recalculate the current commit's diff. */

Commit.prototype.rediff = async function ()
{
    let tree = await this.checkout_before();
    await this.apply(tree);
    let output = Bun.spawnSync(
	["git", "log", "-U4", "-p", "--no-renames", "HEAD~1..HEAD"], {
	    stdio: [null, "pipe", null],
	    cwd: tree,
	}
    ).stdout.toString();

    let gitlog = new GitLog(output);
    this.difftext = "";
    for (let commit of gitlog.commits) {
	this.difftext += commit.difftext;
    }
    this.dirty();

    await dontneed(tree);

    return {
	success: true,
    };
};

/* "1" ... "5": apply quick tag to selected commits. */

Commit.prototype.tag = async function (tag)
{
    if (this.tags.indexOf(tag) === -1) {
	this.tags.push(tag);
	this.tags.sort();
	this.dirty();
    } else {
	this.tags.splice(this.tags.indexOf(tag), 1);
	this.tags.sort();
	this.dirty();
    }

    return {
	success: true,
    };
};

Commit.prototype.tag_1 = async function ()
{
    return await this.tag("1");
};

Commit.prototype.tag_2 = async function ()
{
    return await this.tag("2");
};

Commit.prototype.tag_3 = async function ()
{
    return await this.tag("3");
};

Commit.prototype.tag_4 = async function ()
{
    return await this.tag("4");
};

Commit.prototype.tag_5 = async function ()
{
    return await this.tag("5");
};

/* Mark this commit as settled, not to be optimized further. */

Commit.prototype.settle = function (settled = true)
{
    this.settled = settled;
    this.dirty();
};

/* "x": extract the current commit from its siblings, and assign it a new id. */

Commit.prototype.extract = async function ()
{
    if (typeof this.orig_id === "string") {
	return await this.reassign();
    }
    if (!("shard" in this.orig_id)) {
	return await this.reassign();
    }
    let old_key = JSON.stringify(this.orig_id);
    let old_orig_id = this.orig_id;
    let { shard, rs, n } = this.orig_id;
    for (let r of rs) {
	let didsomething = true;
	something:
	while (didsomething) {
	    didsomething = false
	    for (let other of [...this.commit_tree]) {
		if (this === other)
		    continue;
		let json = JSON.parse(JSON.stringify(other.toJSON()));
		let orig_id = json.orig_id;
		if (orig_id.shard && JSON.stringify(orig_id.shard) === JSON.stringify(shard) &&
		    orig_id.n === n) {
		    for (let or of orig_id.rs) {
			if (or[0] >= r[1]) {
			    or[0] -= r[1] - r[0];
			    or[1] -= r[1] - r[0];
			}
		    }
		    orig_id.n -= r[1] - r[0];
		    orig_id = OrigId.simplify(orig_id);
		    json.orig_id = orig_id;
		    let commit = Commit.from_json(json, this.commit_tree);
		    commit.commit_tree = this.commit_tree;
		    commit.resolve_children();
		    other.delete([commit], [commit]);
		    other.dirty();
		    commit.dirty();
		    this.commit_tree.map.set(JSON.stringify(commit.orig_id), commit);
		    didsomething = true;
		    continue something;
		}
	    }
	}
    }
    let ret = await this.reassign();
    this.dirty();
    return ret;
};

/* Local action for moveup_1. */

Commit.prototype.moveup = async function ()
{
    let conflicts = [];
    let child = this.commit_tree.by_orig_id(this.orig_id);
    let parents = child.get_parents().slice();
    if (!parents.length)
	return {
	    success: false,
	};
    if (parents.length > 1) {
	for (let i = 0; i < parents.length; i++) {
	    let parent = parents[i];
	    let remaining_parents = [...parents];
	    remaining_parents.splice(i, 1);
	    let series_a = [this.commit_tree.by_orig_id(this.commit_tree.base_orig_id), ...this.commit_tree.by_orig_id(this.commit_tree.base_orig_id).generate_first_series([child, parent]).slice(1)];
	    series_a.push(...child.generate_first_series([]));
	    let p_a = series_conflict(series_a);
	    await p_a;
	    if (await p_a) {
		conflicts.push(await p_a);
		continue;
	    }
	    parent.children.splice(parent.children.indexOf(child), 1);
	    parent.dirty();
	    return {
		success: true,
	    };
	}
    } else if (parents[0] && parents[0].get_parents().length > 1) {
	let path = path_to(this.commit_tree, parents[0].get_parents()).slice(1);
	let series_b = [];
	let series_c = [];
	series_b.push(this.commit_tree.by_orig_id(this.commit_tree.base_orig_id));
	series_b.push(...path);
	series_b.push(parents[0].generate_first_series([child]));
	series_b.push(child.generate_first_series([]));
	series_c.push(this.commit_tree.by_orig_id(this.commit_tree.base_orig_id));
	series_c.push(...path);
	series_c.push(child.generate_first_series([]));
	series_c.push(parents[0].generate_first_series([child]));
	let p_b = series_conflict(series_b);
	await p_b;
	let p_c = series_conflict(series_c);
	await p_c;
	if (!await p_b && !await p_c) {
	    let parent = parents[0];
	    for (let pparent of parents[0].get_parents()) {
		pparent.children.push(child);
		pparent.dirty();
	    }
	    parent.children.splice(parent.children.indexOf(child), 1);
	    parent.dirty();
	}
    }
    for (let parent of parents) {
	let pparents = parent.get_parents().slice();
	if (!pparents.length)
	    continue;
	let p_c, p_d;
	{
	    let series_c = [];
	    series_c.push(pparents[0]);
	    series_c.push(...parent.generate_first_series([child]));
	    series_c.push(...child.generate_first_series());
	    p_c = series_conflict(series_c);
	}
	await p_c;
	{
	    let series_d = [];
	    series_d.push(pparents[0]);
	    series_d.push(...child.generate_first_series());
	    series_d.push(...parent.generate_first_series([child]));
	    p_d = series_conflict(series_d);
	}
	await p_d;
	if (await p_c) {
	    conflicts.push(await p_c);
	    continue;
	}
	if (await p_d) {
	    conflicts.push(await p_d);
	    continue;
	}
	{
	    child.dirty();
	    let index;
	    while ((index = parent.children.indexOf(child)) !== -1) {
		parent.children.splice(index, 1);
	    }
	    parent.dirty();
	    for (let pparent of pparents) {
		let children = [child];
		if (pparent.children.indexOf(child) !== -1)
		    children = [];
		if ((index = pparent.children.indexOf(parent)) !== -1) {
		    pparent.children.splice(index, 0, ...children);
		    children = [];
		}
		pparent.children.splice(0, 0, ...children);
		pparent.dirty();
	    }

	    return {
		success: true,
	    };
	}
    }
    for (let parent of parents) {
	let t = this.commit_tree;
	let base = t.by_orig_id(t.base_orig_id);
	let pparents = parent.get_parents().slice();
	if (!pparents.length)
	    continue;
	if (parents.length === 1 && pparents.length === 1)
	    continue;
	let p_c, p_d;
	{
	    let series_c = [];
	    series_c.push(this.commit_tree.by_orig_id(this.commit_tree.base_orig_id));
	    series_c.push(...base.generate_first_series([parent, child]).slice(1));
	    series_c.push(...parent.generate_first_series([child]));
	    series_c.push(...child.generate_first_series());
	    p_c = series_conflict(series_c);
	}
	await p_c;
	{
	    let series_d = [];
	    series_d.push(this.commit_tree.by_orig_id(this.commit_tree.base_orig_id));
	    series_d.push(...base.generate_first_series([parent, child]).slice(1));
	    series_d.push(...child.generate_first_series());
	    series_d.push(...parent.generate_first_series([child]));
	    p_d = series_conflict(series_d);
	}
	await p_d;
	if (await p_c) {
	    conflicts.push(await p_c);
	    continue;
	}
	if (await p_d) {
	    conflicts.push(await p_d);
	    continue;
	}
	{
	    child.dirty();
	    let index;
	    while ((index = parent.children.indexOf(child)) !== -1) {
		parent.children.splice(index, 1);
	    }
	    parent.dirty();
	    for (let pparent of pparents) {
		let children = [child];
		if (pparent.children.indexOf(child) !== -1)
		    children = [];
		if ((index = pparent.children.indexOf(parent)) !== -1) {
		    pparent.children.splice(index, 0, ...children);
		    children = [];
		}
		pparent.children.splice(0, 0, ...children);
		pparent.dirty();
	    }

	    return {
		success: true,
	    };
	}
    }
    return {
	success: false,
	message: "exhausted parents",
	conflicts,
    };
};

/* "k": kill the commit, changing the output. */

Commit.prototype.kill = async function ()
{
    // await this.extract();
    this.delete([], [...this.children]);
    this.dirty();

    return {
	success: true,
    };
};

/* "p": "Push" a commit into its parent. */

Commit.prototype.push = async function ()
{
    for (let parent of this.get_parents()) {
	if (parent) {
	    let sel = new CommitSelection();
	    sel.add(this);
	    sel.add(parent);
	    return await sel.join();
	}
    }
    return {
	success: false,
    };
};

/* Shuffle an array. */

function shuffle(list)
{
    list = list.slice();
    let ret = [];
    while (list.length) {
	let i = Math.floor(Math.random() * list.length);
	ret.push(...list.splice(i, 1));
    }
    return ret;
}

function generate_series(branch, set = new Set(branch.parents))
{
    for (let parent of branch.parents) {
	if (!set.has(parent))
	    return;
    }
    set.add(branch);
    let series = [branch.id];
    for (let child of shuffle(branch.children)) {
	let ret = generate_series(child, set);
	if (ret)
	    series.push(...ret);
    }
    return series;
}

function generate_first_series(branch, set = new Set(branch.parents), exclude = new Set())
{
    if (exclude.has(branch))
	return [];
    for (let parent of branch.parents) {
	if (!set.has(parent))
	    return;
    }
    set.add(branch);
    let series = [branch.id];
    for (let child of branch.children) {
	let ret = generate_first_series(child, set, exclude);
	if (ret)
	    series.push(...ret);
    }
    return series;
}

/* A selection of commits. Currently a glorified array. */

function CommitSelection()
{
    Array.call(this);
}

CommitSelection.prototype = Object.create(Array.prototype);

/* Join the commits in this selection. */

CommitSelection.prototype.join = async function ()
{
    let [a, b] = this;
    let json = await locked_fetch_json(
	"/join?a=" + encodeURIComponent(JSON.stringify(a.orig_id)) + "&b=" + encodeURIComponent(JSON.stringify(b.orig_id)),
    );
    await update();
    if (json.success) {
	a.delete();
	b.delete();
    }
    await redisplay();
    return json;
};

/* Add `commit` to this selection. */

CommitSelection.prototype.add = function (commit)
{
    if (this.indexOf(commit) === -1)
	this.push(commit);
    commit.select();
};

/* Add the selected commits' brethren, i.e. same-level siblings, to the selection. */

CommitSelection.prototype.brethren = async function ()
{
    for (let commit of this) {
	for (let parent of commit.get_parents()) {
	    for (let child of parent.children) {
		if (child.commit_message === commit.commit_message) {
		    child.select();
		}
	    }
	}
    }
};

/* Overly generic find-the-next-commit function. */

CommitSelection.prototype.move_sp = async function ({x = 0, y = 0})
{
    function sp(r) {
	return x * r.x + y * r.y;
    }
    for (let commit of this) {
	if (!commit.div) {
	    commit.select(false);
	    commit.dirty();
	}
    }
    if (this.length > 1) {
	let best;
	let best_rect;
	for (let commit of this) {
	    let rect = commit.div.cb.getBoundingClientRect();
	    if (!best_rect || sp(rect) > sp(best_rect)) {
		best = commit;
		best_rect = rect;
	    }
	}
	for (let commit of this) {
	    if (commit !== best) {
		commit.select(false);
		commit.dirty();
	    }
	}
    }
    if (this.length === 1) {
	let cb = this[0]?.div?.cb;
	if (!cb) {
	    return {
		success: false,
		message: "selected invisible commit",
	    };
	}
	let my_rect = cb.getBoundingClientRect();
	let best;
	let best_rect;
	for (let commit of this[0].commit_tree) {
	    if (commit.div) {
		let rect = commit.div.cb.getBoundingClientRect();
		if (sp(rect) > sp(my_rect) && (!best_rect || sp(rect) < sp(best_rect))) {
		    best = commit;
		    best_rect = rect;
		}
	    }
	}
	if (best) {
	    this[0].select(false);
	    this[0].dirty();
	    best.select();
	    best.dirty();
	    best.div.cb.scrollIntoView({
		block: "center",
		inline: "center",
	    });
	    return {
		success: true,
	    };
	}
    }
    return {
	success: false,
    };
};

/* "↑": move to the previous commit (in visual order). */

CommitSelection.prototype.move_up = async function ()
{
    return await this.move_sp({y: -1})
};

/* "↓": move to the next commit (in visual order). */

CommitSelection.prototype.move_down = async function ()
{
    return await this.move_sp({y: 1})
};

/* "←": move to the previous sibling commit. */

CommitSelection.prototype.move_previous = async function ()
{
    if (this.length === 1) {
	let [parent] = this[0].get_parents();
	if (parent) {
	    let i = parent.children.indexOf(this[0]);
	    if (i > 0)
		i--;
	    let best = parent.children[i];
	    if (best) {
		this[0].select(false);
		best.select();
		best.div.cb.scrollIntoView({
		    block: "center",
		    inline: "center",
		});
		return {
		    success: true,
		};
	    }
	}
    }
    return {
	success: false,
    };
};

/* "→": move to the previous sibling commit. */

CommitSelection.prototype.move_next = async function ()
{
    if (this.length === 1) {
	let [parent] = this[0].get_parents();
	if (parent) {
	    let i = parent.children.indexOf(this[0]);
	    if (i < parent.children.length - 1)
		i++;
	    let best = parent.children[i];
	    if (best) {
		this[0].select(false);
		best.select();
		best.div.cb.scrollIntoView({
		    block: "center",
		    inline: "center",
		});
		return {success: true};
	    }
	}
    }
    return {success: false};
};

/* The selection changed. Recreate it by examining all commits' "selected" prop. */

CommitSelection.prototype.selection_changed = async function ()
{
    while (this.length)
	this.pop();
    for (let commit of gCommitTree) {
	if (commit.selected)
	    if (this.indexOf(commit) === -1)
		this.push(commit);
    }
    let total_selected = this.length;
    if (total_selected === 0)
	document.getElementById("total-selected").innerText = "";
    else if (total_selected === 1)
	document.getElementById("total-selected").innerText = "selected";
    else
	document.getElementById("total-selected").innerText = total_selected + " commits selected";

    document.getElementById("total-selected").innerText += ` ${[...gCommitTree].filter(x => !x.settled).length}/${[...gCommitTree].length} `;

    if (total_selected === 1) {
	let [commit] = this;
	await commit.display_metadata();
	await commit.display_difftext();
    } else {
	document.getElementById("heading-metadata").innerText = "";
	document.getElementById("buttons-metadata").innerText = "";
	document.getElementById("metadata").innerText = "";
	document.getElementById("diff").innerText = "";
    }
};

/* Scroll the current commit into view. */

Commit.prototype.scroll_into_view = function ()
{
    if (this.div && this.div.cb)
	this.div.cb.scrollIntoView({
	    block: "center",
	    inline: "center",
	});
};

/* "(": move the current commit up in the list. */

Commit.prototype.move_commit_up = async function ()
{
    for (let parent of this.get_parents()) {
	let index = parent.children.indexOf(this);
	if (index > 0) {
	    let me = parent.children.splice(index, 1);
	    parent.children.splice(index - 1, 0, this);
	    parent.dirty();
	    this.dirty();
	}
    }
    this.scroll_into_view();
    return {success: true};
};

/* ")": move the current commit down in the list. */

Commit.prototype.move_commit_down = async function ()
{
    for (let parent of this.get_parents()) {
	let index = parent.children.indexOf(this);
	if (index >= 0 && index < parent.children.length - 1) {
	    let me = parent.children.splice(index, 1);
	    parent.children.splice(index + 1, 0, this);
	    parent.dirty();
	    this.dirty();
	}
    }
    this.scroll_into_view();
    return {success: true};
};

/* "!" ... "%": select commits tagged with 1 .. 5 */

Commit.prototype.gather = async function (tag)
{
    for (let commit of gCommitTree) {
	if (commit.tags.indexOf(tag) !== -1)
	    commit.select();
    }
};

Commit.prototype.gather_1 = async function ()
{
    return await this.gather("1");
};

Commit.prototype.gather_2 = async function ()
{
    return await this.gather("2");
};

Commit.prototype.gather_3 = async function ()
{
    return await this.gather("3");
};

Commit.prototype.gather_4 = async function ()
{
    return await this.gather("4");
};

Commit.prototype.gather_5 = async function ()
{
    return await this.gather("5");
};

/* List of actions to be forwarded from the client to the server. */

function remote_actions()
{
    return [
	"extract",
	"isolate",
	"kill",
	"move_commit_down",
	"move_commit_up",
	"moveup",
	"reassign",
	"rediff",
	"revert",
	"shatter",
	"verify",
    ];
}

/* The global list of key bindings. */

function find_action(key) {
    let actions = {
	"ArrowUp": "move_up",
	"ArrowDown": "move_down",
	"ArrowLeft": "move_previous",
	"ArrowRight": "move_next",
	"Tab": "move_next_visual",
	"a": "all",
	"b": "brethren",
	"c": "center",
	"d": "rediff",
	"e": "edit",
	"f": "follow",
	"g": "good",
	"h": "hide",
	"i": "isolate",
	"j": "join",
	"k": "kill",
	"l": "look",
	"m": "moveup",
	"n": "next",
	"o": "one",
	"p": "push",
	"q": "quit",
	"s": "shatter",
	"t": "tree",
	"u": "update",
	"v": "verify",
	"w": "widen",
	"x": "extract",
	"y": "why",
	"z": "zero",
	"+": "add",
	"-": "remove",
	"Enter": "loop",
	"Return": "loop",
	"BackSpace": "undo",
	"1": "tag_1",
	"2": "tag_2",
	"3": "tag_3",
	"4": "tag_4",
	"5": "tag_5",
	"!": "gather_1",
	"@": "gather_2",
	"#": "gather_3",
	"$": "gather_4",
	"%": "gather_5",
	"(": "move_commit_up",
	")": "move_commit_down",
	"PageUp": "diff_page_up",
	"PageDown": "diff_page_down",
	" ": "nop",
    };
    return actions[key];
}

/* Return a global action, an async function to be called which
 * doesn't depend on, or depends in weird ways on, the current
 * selection. */

function find_global_action(action) {
    let global_actions = {
	/* "a": Select all commits. */
	async all() {
	    for (let commit of gCommitTree) {
		commit.select();
	    }
	},
	/* "c": Center the current commit, or one of them. */
	async center() {
	    let [commit] = gSelection;
	    if (commit) {
		document.getElementById("follow").checked = false;
		commit.div.cb.scrollIntoView({
		    block: "center",
		    inline: "center",
		});
	    }
	},
	/* "Return": start/stop the simplification loop.*/
	async loop() {
	    document.getElementById("loop").click();
	},
	/* "f": keep the current loop item in focus. */
	async follow() {
	    document.getElementById("follow").click();
	},
	/* "z": clear the selection, selecting zero commits. */
	async zero() {
	    for (let commit of gSelection) {
		commit.select(false);
		commit.dirty();
	    }
	    await update();
	    await redisplay();
	},
	/* "o": clear the selection, but retain one commit. */
	async one() {
	    if (gOneSuggestion) {
		for (let commit of gSelection) {
		    commit.select(false);
		    commit.dirty();
		}
		await update();
		await redisplay();
		gOneSuggestion.select();
		gOneSuggestion.dirty();
		await update();
		await redisplay();
	    }
	},
	/* "y": show the commit blocking the current commit's simplification. */
	async why() {
	    if (gOneSuggestionWhy) {
		for (let commit of gSelection) {
		    commit.selected = false;
		    commit.dirty();
		}
	    await update();
		await redisplay();
		gOneSuggestionWhy.selected = true;
	    await update();
		await redisplay();
	    }
	},
	/* "ArrowDown": move to the next commit in visual order. */
	async move_next_visual() {
	    while (gSelection.length === 1) {
		let [commit] = gSelection;
		if (commit.children.length > 0) {
		    commit.selected = false;
		    commit.children[commit.children.length-1].selected = true;
		    commit.children[commit.children.length-1].div.cb.scrollIntoView({ block: "center", inline: "center", });
		    await update();
		    await redisplay();
		    return;
		}
		commit.selected = false;
		commit = commit.get_parents()[0];
		commit.selected = true;
		gSelection.pop();
		gSelection.add(commit);
		await update();
		await redisplay();
	    }
	},
	/* "u": force an update, clearing the "settled" bits. */
	async update() {
	    for (let commit of gCommitTree) {
		if (commit.settled) {
		    commit.settled = false;
		    commit.dirty();
		}
	    }
	    await update();
	    await redisplay();

	    return {
		success: true,
	    };
	},
	/* "PgUp": scroll the diff pane up. */
	async diff_page_up() {
	    let diffpane = document.getElementById("diffpane");
	    if (diffpane)
		diffpane.scrollBy(0, -200);
	    return {
		success: true,
	    };
	},
	/* "PgDown": scroll the diff pane down. */
	async diff_page_down() {
	    let diffpane = document.getElementById("diffpane");
	    if (diffpane)
		diffpane.scrollBy(0, 200);
	    return {
		success: true,
	    };
	},
	async next() {
	    if (gCommitTree.queued_commits.length) {
		let commit = gCommitTree.queued_commits.shift();
		for (let leaf of gCommitTree) {
		    if (!leaf.get_parents().length)
			continue;
		    if (leaf.children.length)
			continue;
		    leaf.children.push(commit);
		}
		await update();
		await redisplay();
	    }
	},
	async quit() {
	    await locked_fetch_json("/quit");
	    await update();
	    await redisplay();
	},
    };

    return global_actions[action];
}

/* Hack to turn "remote" actions into mere fetch requests on the client side. */

async function install_remote_actions()
{
    for (let action of remote_actions()) {
	let old_action = Commit.prototype[action];
	if (old_action) {
	    let new_action = async function (...args) {
		if (args.length === 0) {
		    let json = await locked_fetch_json("/action/" + action + "?orig_id=" + encodeURIComponent(JSON.stringify(this.orig_id)));
		    return json;
		}
		if (args.length > 1) {
		    let [a, b] = args;
		    let json = await locked_fetch_json("/action/" + action + "?a=" + encodeURIComponent(JSON.stringify(args[0].orig_id)) + "&b=" + encodeURIComponent(JSON.stringify(args[1].orig_id)));
		    return json;
		}
	    };
	    Commit.prototype[action] = new_action;
	}
    }
}

var gShortIdTab = new ShortIdTab();
var gShortIdTabFilename = new ShortIdTab();
