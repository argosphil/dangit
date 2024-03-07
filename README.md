Dangit is...well, it's nothing yet, because I'm writing the README
first. It's meant to be a tool, or possibly several, which improve git
repository histories by treating the history as a directed acyclic
network. So it's "directed acyclic networks for git", but you can
still pronounce it "dangit".

Git has a linear commit history: every commit can, in theory, depend
on changes made by every preceding commit, and there is absolutely no
infrastructure reflecting that that's actually a rare special
case. Normally, most commits from separate lines of development
commute, in the sense that you can apply the diff from either commit
first and the diff from the other commit will still apply, and you'll
end up with the same result either way.

So dangit's DANs try to be representations of git histories as graphs
(I only chose "networks" for the acronym) with the nodes being commits
and an edge pointing from commit A to commit B if it is a good idea
not to apply commit B without first applying commit A. In theory, if I
choose any sequence of all commits such that commit A never comes
after commit B (for all edges), it should apply in that order, and not
give me diff conflicts.

Quite often, this directed acyclic network is both a directed acyclic
graph and a tree, and we'll represent it as such:

```
ea6bf1257 [1] fix(install): auto `node-gyp` script bugfix (#9289)
 15cae87f1 [39] fix syntax
  d82bf7307 [40] collect some metadata about tests
   c9502645b [41] write metadata to file and upload
    5787e9140 [42] I hear all the cool kids are using JSON
     dc9ea10b4 [43] pp json
      b20f5a4a0 [44] more (derived) data
 de052badf [45] build:fast script, for fast builds
  cf23c538c [46] BuildFast support
   f38f0ee37 [47] [CI] try to set CMAKE_BUILD_TYPE from the CI workflow
    d51448c6d [48] [CI] I guess WEBKIT_DIR is set
     eeee9cb1f [49] [CI] build tinycc from our sources
      e5b46d0ee [50] [CI] split a command
```

That means there's an edge from commit [1] to [39], one from [39] to
[40], and so on until one from [43] to [44]. There's no edge from [44]
to [45], but there is one from [1] to [45].

In fact, one tree which trivially has the property we demand is the
git linear history: every commit depends on the one before it, there's
only one way to traverse the tree, and we know that that patch series
applies because of how it's generated.

So our task is, first, to take that linear tree and turn it into a
more shallow one, which allows many reorderings of commit subtrees.

Unfortunately, to work out the best such tree is computationally
infeasible for any reasonable number of commits[citation needed],
since the dependencies between commits are complex.

That's where we wave our hands in exasperation, because in practice,
it's totally feasible, and git should do it for us but doesn't and
that's annoying. For example, if commit A and commit B affect disjoint
sets of files, OF COURSE there shouldn't be an edge from A to B!

But what if they do affect the same file, but in wildly different
positions? That makes it VERY UNLIKELY there's an edge from A to B,
but it's theoretically possible.

And if applying B's diff first, then applying A's, throws a diff
error, it's DEFINITELY TRUE that there's edges leading from A to B. In
fact, it's VERY LIKELY there's an edge from A to B.

So we start with the linear tree, and we apply those rules in this order:

1. while there are "OF COURSE" edges, reparent B to A's parent for all
of them, and remove the edge.

2. for the remaining edges, check whether the edge is VERY LIKELY or
VERY UNLIKELY: in the first case, mark it as very likely and keep
it. In the second case, reparent B to A's parent but leave a note that
that might have broken things. In the third case (neither VERY LIKELY
nor VERY UNLIKELY), apply some heuristic I've yet to come up with:
currently, do the same as the VERY LIKELY case but don't mark the
edge.

3. repeat steps (1) and (2) until no further changes are made.

4. come up with a random traversal of the DAG that preserves order.

5. check whether the random traversal works. If it doesn't, try to fix
things.

6. repeat steps (4) and (5) a million times

The result should be VERY LIKELY to be a working DAG for the git
history, and we can use it for further manipulation:

1. fixup! commits, even if the commit message is just "fixup!", will
usually have bubbled up to their proper parents.

2. linear chains of commits indicate that commits depend on each other
to be applied in order, and often that means you will want to squash
them.

3. you can reorder sub-DAGs that don't re-join later on as you see
fit, in order to put features in a logical order.

4. you can, and should, introduce additional edges representing
logical dependencies between commits that don't affect the diff
algorithm: for example, a function definition should depend on the
diff adding its function declaration, and usages of the new function
should depend on the definition.

5. if a commit has several parents, you should probably split it up
into separate commits for each parent. dangit will help you do that by
shattering commits when requested, resulting in a new commit for each
hunk in the diff.

Note that the author is aware that the actual dependencies between
commits are more complicated than the DAN represents. They're also
aware that the algorithm outlined above will not always result in a
valid DAN. But in practice, even applying only the "OF COURSE" rule,
it will be much more pleasant to interact with a DAN than it is to
interact with a linear commit history. For example, if you fix a typo
and you know there's a previous commit which added the line with a
typo, just use a "fixup!" commit message and let dangit do the rest:
it'll find the previous commit and apply the fixup.

It's meant to be useful in practice for actual git repositories, not
to be perfect in theory.
