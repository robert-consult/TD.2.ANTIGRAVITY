import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  SmilePlus,
  Tag,
  TrendingUp,
  TrendingDown,
  Calendar,
  Filter,
  Search,
  Link2,
  X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";

interface JournalEntry {
  id: number;
  userId: number;
  tradeId: number | null;
  tradeIds: string | null; // JSON array of trade IDs
  note: string;
  mood: string | null;
  tags: string | null;
  attachmentUrl: string | null;
  createdAt: number | string | Date;
  updatedAt: number | string | Date;
}

export default function JournalPage() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { locale } = useI18n();
  const sideLabels: Record<string, { label: string }> = {
    BUY: { label: "Buy" },
    SELL: { label: "Sell" },
  };

  const getSideKey = (side: unknown) => String(side ?? "").trim().toUpperCase();

  const getSideLabel = (side: unknown) => {
    const key = getSideKey(side);
    if (!key) return "?";
    return sideLabels[key]?.label ?? key;
  };

  const getSideBadgeClass = (side: unknown) => {
    const key = getSideKey(side);
    if (key === "BUY") {
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
    }
    if (key === "SELL") {
      return "border-red-500/40 bg-red-500/15 text-red-300";
    }
    return "border-muted-foreground/40 bg-muted/20 text-muted-foreground";
  };

  const moodOptions = [
    { value: "confident", label: "Confident", color: "bg-green-500" },
    { value: "calm", label: "Calm", color: "bg-blue-500" },
    { value: "anxious", label: "Anxious", color: "bg-yellow-500" },
    { value: "frustrated", label: "Frustrated", color: "bg-orange-500" },
    { value: "fearful", label: "Fearful", color: "bg-red-500" },
    { value: "greedy", label: "Greedy", color: "bg-purple-500" },
    { value: "neutral", label: "Neutral", color: "bg-gray-500" },
  ];

  const commonTagOptions = [
    { value: "breakout", label: "Breakout" },
    { value: "trend-following", label: "Trend following" },
    { value: "reversal", label: "Reversal" },
    { value: "scalp", label: "Scalp" },
    { value: "swing", label: "Swing" },
    { value: "news-driven", label: "News-driven" },
    { value: "technical", label: "Technical" },
    { value: "fundamental", label: "Fundamental" },
    { value: "lesson-learned", label: "Lesson learned" },
    { value: "mistake", label: "Mistake" },
    { value: "over-trading", label: "Over trading" },
    { value: "profitable", label: "Profitable" },
    { value: "loss", label: "Loss" },
  ];

  const tagLabel = (tag: string) => {
    const known = commonTagOptions.find((t) => t.value === tag);
    return known?.label ?? tag;
  };

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null);
  const [newNote, setNewNote] = useState("");
  const [newMood, setNewMood] = useState<string>("");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [moodFilter, setMoodFilter] = useState<string>("all_moods");
  const [selectedTradeIds, setSelectedTradeIds] = useState<number[]>([]);
  const [tradeSearchQuery, setTradeSearchQuery] = useState("");

  const toMs = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") {
      return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const asNum = Number(trimmed);
      if (Number.isFinite(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum;
      const asDate = new Date(trimmed);
      return Number.isFinite(asDate.getTime()) ? asDate.getTime() : null;
    }
    return null;
  };

  const formatDate = (timestamp: unknown) => {
    const ms = toMs(timestamp);
    if (ms === null) return "Unknown date";
    const date = new Date(ms);
    if (isNaN(date.getTime())) return "Invalid date";
    return date.toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const { data: entries = [], isLoading, isError } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal"],
    enabled: !!user,
  });

  // Fetch closed trades for linking
  const { data: trades = [] } = useQuery<any[]>({
    queryKey: ["/api/trades"],
    enabled: !!user,
  });

  // Filter to only closed trades
  const closedTrades = trades.filter((t: any) => {
    const status = String(t.status ?? "").toUpperCase();
    const hasClosePrice = t.closePrice !== null && t.closePrice !== undefined;
    const hasClosedAt = t.closedAt !== null && t.closedAt !== undefined;
    return status === "CLOSED" || hasClosePrice || hasClosedAt;
  });
  
  // Filter trades based on search and sort by most recent first
  const filteredTrades = closedTrades
    .filter((trade: any) => {
      if (!tradeSearchQuery) return true;
      const symbol = trade.symbol?.symbol || trade.symbol || "";
      const side = String(trade.side ?? trade.type ?? "");
      const searchLower = tradeSearchQuery.toLowerCase();
      return symbol.toLowerCase().includes(searchLower) ||
             side.toLowerCase().includes(searchLower) ||
             String(trade.profit || "").includes(searchLower);
    })
    .sort((a: any, b: any) => {
      // Sort by close time, most recent first
      const aTime = toMs(a.closedAt ?? a.closeTime ?? a.updatedAt ?? a.openedAt) ?? 0;
      const bTime = toMs(b.closedAt ?? b.closeTime ?? b.updatedAt ?? b.openedAt) ?? 0;
      const aTs = aTime;
      const bTs = bTime;
      return bTs - aTs;
    })
    .slice(0, 20); // Limit to 20 for performance

  const createMutation = useMutation({
    mutationFn: async (data: { note: string; mood: string | null; tags: string[] | null; tradeIds: number[] | null }) => {
      return await apiRequest("POST", "/api/journal", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Entry added", description: "Journal entry saved successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create entry", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { note: string; mood: string | null; tags: string[] | null; tradeIds: number[] | null } }) => {
      return await apiRequest("PUT", `/api/journal/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
      setEditEntry(null);
      resetForm();
      toast({ title: "Entry updated", description: "Journal entry updated successfully" });
    },
    onError: (error: Error) => {
      const message = error instanceof ApiError && error.message
        ? error.message
        : "Failed to update entry";
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/journal/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal"] });
      toast({ title: "Entry deleted", description: "Journal entry removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setNewNote("");
    setNewMood("");
    setNewTags([]);
    setCustomTag("");
    setSelectedTradeIds([]);
    setTradeSearchQuery("");
  };

  const handleCreate = () => {
    if (newNote.trim().length < 3) {
      toast({ title: "Error", description: "Note must be at least 3 characters", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      note: newNote.trim(),
      mood: newMood || null,
      tags: newTags.length > 0 ? newTags : null,
      tradeIds: selectedTradeIds.length > 0 ? selectedTradeIds : null,
    });
  };

  const handleUpdate = () => {
    if (!editEntry) return;
    if (newNote.trim().length < 3) {
      toast({ title: "Error", description: "Note must be at least 3 characters", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: editEntry.id,
      data: {
        note: newNote.trim(),
        mood: newMood || null,
        tags: newTags.length > 0 ? newTags : null,
        tradeIds: selectedTradeIds.length > 0 ? selectedTradeIds : null,
      },
    });
  };

  // Helper to parse tradeIds from entry (supports both old tradeId and new tradeIds)
  const parseEntryTradeIds = (entry: JournalEntry): number[] => {
    // First check new tradeIds field
    if (entry.tradeIds) {
      try {
        const ids = JSON.parse(entry.tradeIds);
        if (Array.isArray(ids)) return ids;
      } catch {}
    }
    // Fallback to legacy tradeId
    if (entry.tradeId) return [entry.tradeId];
    return [];
  };

  const openEditDialog = (entry: JournalEntry) => {
    setEditEntry(entry);
    setNewNote(entry.note);
    setNewMood(entry.mood || "");
    setSelectedTradeIds(parseEntryTradeIds(entry));
    try {
      setNewTags(entry.tags ? JSON.parse(entry.tags) : []);
    } catch {
      setNewTags([]);
    }
  };

  // Helper to format trade for display
  const formatTradeOption = (trade: any) => {
    const symbol = trade.symbol?.symbol || trade.symbol || "Unknown";
    const profit = parseFloat(trade.profit || 0);
    const profitColor = profit >= 0 ? "text-green-500" : "text-red-500";
    const sideKey = getSideKey(trade.side || trade.type);
    const side = getSideLabel(sideKey);
    const sideBadgeClass = getSideBadgeClass(sideKey);
    return { symbol, profit, profitColor, side, sideBadgeClass };
  };

  // Toggle trade selection
  const toggleTradeSelection = (tradeId: number) => {
    setSelectedTradeIds(prev => 
      prev.includes(tradeId) 
        ? prev.filter(id => id !== tradeId)
        : [...prev, tradeId]
    );
  };

  // Remove trade from selection
  const removeTradeSelection = (tradeId: number) => {
    setSelectedTradeIds(prev => prev.filter(id => id !== tradeId));
  };

  // Get selected trades info
  const selectedTrades = closedTrades.filter((t: any) => selectedTradeIds.includes(t.id));

  const addTag = (tag: string) => {
    const tagClean = tag.trim().toLowerCase();
    if (tagClean && !newTags.includes(tagClean) && newTags.length < 20) {
      setNewTags([...newTags, tagClean]);
    }
    setCustomTag("");
  };

  const removeTag = (tag: string) => {
    setNewTags(newTags.filter((t) => t !== tag));
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch = searchQuery
      ? entry.note.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (entry.tags && entry.tags.toLowerCase().includes(searchQuery.toLowerCase()))
      : true;
    const matchesMood = moodFilter !== "all_moods" ? entry.mood === moodFilter : true;
    return matchesSearch && matchesMood;
  });

  const getMoodColor = (mood: string | null) => {
    return moodOptions.find((m) => m.value === mood)?.color || "bg-gray-500";
  };

  const getMoodLabel = (mood: string | null) => {
    return moodOptions.find((m) => m.value === mood)?.label || mood || "No mood";
  };

  const parseTags = (tags: string | null): string[] => {
    if (!tags) return [];
    try {
      return JSON.parse(tags);
    } catch {
      return [];
    }
  };

  // Loading state while checking authentication
  if (authLoading || (user && isLoading)) {
    return (
      <div className="min-h-screen min-h-dvh bg-background flex items-center justify-center page-pad">
        <div className="text-center space-y-4">
          <BookOpen className="h-12 w-12 mx-auto text-emerald-500 animate-pulse" />
          <p className="text-muted-foreground">Loading your journal...</p>
        </div>
      </div>
    );
  }

  // Redirect if not logged in
  if (!user) {
    return (
      <div className="min-h-screen min-h-dvh bg-background flex items-center justify-center page-pad">
        <Card className="max-w-md w-full mx-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              Trading Journal
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">Please log in to view your trading journal.</p>
            <Button onClick={() => navigate("/")}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh bg-background">
      <div className="page-pad mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <BookOpen className="h-8 w-8 text-emerald-500" />
            <div>
              <h1 className="text-2xl font-bold">Trading Journal</h1>
              <p className="text-muted-foreground text-sm">
                Track your thoughts, emotions, and lessons
              </p>
            </div>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                New Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Journal Entry</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Your thoughts</label>
                  <Textarea
                    placeholder="What happened today? What did you learn? How are you feeling about your trades?"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    rows={4}
                    className="resize-y min-h-[60px] max-h-[300px]"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Link2 className="h-4 w-4" /> Link to Trade(s) (Optional)
                  </label>
                  {selectedTrades.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {selectedTrades.map((trade: any) => {
                        const { symbol, profit, profitColor, side, sideBadgeClass } = formatTradeOption(trade);
                        return (
                          <div key={trade.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                            <div className="flex-1 flex items-center gap-2">
                              <span className="font-medium">{symbol}</span>
                              <Badge variant="outline" className={`text-xs ${sideBadgeClass}`}>{side}</Badge>
                              <span className={profitColor}>${profit.toFixed(2)}</span>
                              <span className="text-xs text-muted-foreground">#{trade.id}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeTradeSelection(trade.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Input
                      placeholder="Search trades by symbol, side, or P/L..."
                      value={tradeSearchQuery}
                      onChange={(e) => setTradeSearchQuery(e.target.value)}
                    />
                    {tradeSearchQuery && (
                      <ScrollArea className="h-[150px] border rounded-md">
                        <div className="p-2 space-y-1">
                          {filteredTrades.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              No closed trades found
                            </p>
                          ) : (
                            filteredTrades.map((trade: any) => {
                              const { symbol, profit, profitColor, side, sideBadgeClass } = formatTradeOption(trade);
                              const isSelected = selectedTradeIds.includes(trade.id);
                              return (
                                <div
                                  key={trade.id}
                                  className={`flex items-center justify-between p-2 rounded cursor-pointer ${isSelected ? 'bg-primary/20 border border-primary' : 'hover:bg-muted'}`}
                                  onClick={() => toggleTradeSelection(trade.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{symbol}</span>
                                    <Badge variant="outline" className={`text-xs ${sideBadgeClass}`}>{side}</Badge>
                                  </div>
                                  <span className={profitColor}>${profit.toFixed(2)}</span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </ScrollArea>
                    )}
                    {closedTrades.length === 0 && (
                      <p className="text-xs text-muted-foreground">No closed trades available to link</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 flex items-center gap-2">
                    <SmilePlus className="h-4 w-4" /> Current Mood
                  </label>
                  <Select value={newMood} onValueChange={setNewMood}>
                    <SelectTrigger>
                    <SelectValue placeholder="How are you feeling?" />
                    </SelectTrigger>
                    <SelectContent>
                      {moodOptions.map((mood) => (
                        <SelectItem key={mood.value} value={mood.value}>
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${mood.color}`} />
                            {mood.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Tag className="h-4 w-4" /> Tags
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {commonTagOptions.map((tag) => (
                      <Badge
                        key={tag.value}
                        variant={newTags.includes(tag.value) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() =>
                          newTags.includes(tag.value) ? removeTag(tag.value) : addTag(tag.value)
                        }
                      >
                        {tag.label}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add custom tag..."
                      value={customTag}
                      onChange={(e) => setCustomTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag(customTag);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addTag(customTag)}
                      disabled={!customTag.trim()}
                    >
                      Add
                    </Button>
                  </div>
                  {newTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {newTags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1">
                          {tagLabel(tag)}
                          <button
                            onClick={() => removeTag(tag)}
                            className="ml-1 hover:text-destructive"
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Saving..." : "Save Entry"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search entries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={moodFilter} onValueChange={setMoodFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_moods">All Moods</SelectItem>
              {moodOptions.map((mood) => (
                <SelectItem key={mood.value} value={mood.value}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${mood.color}`} />
                    {mood.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No journal entries yet</h3>
              <p className="text-muted-foreground mb-4">
                Start documenting your trading journey
              </p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Entry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredEntries.map((entry) => (
              <Card key={entry.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {formatDate(entry.createdAt)}
                      </span>
                      {entry.mood && (
                        <Badge className={`${getMoodColor(entry.mood)} text-white`}>
                          {getMoodLabel(entry.mood)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(entry)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Delete this entry?")) {
                            deleteMutation.mutate(entry.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm">{entry.note}</p>
                  {(() => {
                    const entryTradeIds = parseEntryTradeIds(entry);
                    if (entryTradeIds.length === 0) return null;
                    return (
                      <div className="mt-3 space-y-2">
                        {entryTradeIds.map((tradeId) => {
                          const linkedTrade = trades.find((t: any) => t.id === tradeId);
                          if (!linkedTrade) return null;
                          const { symbol, profit, profitColor, side, sideBadgeClass } = formatTradeOption(linkedTrade);
                          const openTime = linkedTrade.openedAt ? formatDate(linkedTrade.openedAt) : "N/A";
                          const closeTime = linkedTrade.closedAt ? formatDate(linkedTrade.closedAt) : "N/A";
                          const openPrice = linkedTrade.openPrice ? Number(linkedTrade.openPrice).toFixed(5) : "N/A";
                          const closePrice = linkedTrade.closePrice ? Number(linkedTrade.closePrice).toFixed(5) : "N/A";
                          const lots = linkedTrade.lots || linkedTrade.size || "N/A";
                          return (
                            <div key={tradeId} className="p-3 bg-muted/50 rounded-md border space-y-2">
                              <div className="flex items-center gap-2">
                                <Link2 className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{symbol}</span>
                                <Badge variant="outline" className={`text-xs ${sideBadgeClass}`}>{side}</Badge>
                                <span className={`font-semibold ${profitColor}`}>${profit.toFixed(2)}</span>
                                <span className="text-xs text-muted-foreground ml-auto">#{linkedTrade.id}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <div>Lots: <span className="text-foreground">{lots}</span></div>
                                <div>Open: <span className="text-foreground">{openPrice}</span></div>
                                <div>Opened: <span className="text-foreground">{openTime}</span></div>
                                <div>Close: <span className="text-foreground">{closePrice}</span></div>
                                <div>Closed: <span className="text-foreground">{closeTime}</span></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {entry.tags && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {parseTags(entry.tags).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tagLabel(tag)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Journal Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Your thoughts</label>
                <Textarea
                  placeholder="What happened today?"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={4}
                  className="resize-y min-h-[60px] max-h-[300px]"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> Link to Trade(s) (Optional)
                </label>
                {selectedTrades.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {selectedTrades.map((trade: any) => {
                      const { symbol, profit, profitColor, side, sideBadgeClass } = formatTradeOption(trade);
                      return (
                        <div key={trade.id} className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                          <div className="flex-1 flex items-center gap-2">
                            <span className="font-medium">{symbol}</span>
                            <Badge variant="outline" className={`text-xs ${sideBadgeClass}`}>{side}</Badge>
                            <span className={profitColor}>${profit.toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground">#{trade.id}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeTradeSelection(trade.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-2">
                  <Input
                    placeholder="Search trades by symbol, side, or P/L..."
                    value={tradeSearchQuery}
                    onChange={(e) => setTradeSearchQuery(e.target.value)}
                  />
                  {tradeSearchQuery && (
                    <ScrollArea className="h-[150px] border rounded-md">
                      <div className="p-2 space-y-1">
                        {filteredTrades.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            No closed trades found
                          </p>
                        ) : (
                          filteredTrades.map((trade: any) => {
                            const { symbol, profit, profitColor, side, sideBadgeClass } = formatTradeOption(trade);
                            const isSelected = selectedTradeIds.includes(trade.id);
                            return (
                              <div
                                key={trade.id}
                                className={`flex items-center justify-between p-2 rounded cursor-pointer ${isSelected ? 'bg-primary/20 border border-primary' : 'hover:bg-muted'}`}
                                onClick={() => toggleTradeSelection(trade.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{symbol}</span>
                                  <Badge variant="outline" className={`text-xs ${sideBadgeClass}`}>{side}</Badge>
                                </div>
                                <span className={profitColor}>${profit.toFixed(2)}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                  )}
                  {closedTrades.length === 0 && (
                    <p className="text-xs text-muted-foreground">No closed trades available to link</p>
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 flex items-center gap-2">
                  <SmilePlus className="h-4 w-4" /> Current Mood
                </label>
                <Select value={newMood} onValueChange={setNewMood}>
                  <SelectTrigger>
                    <SelectValue placeholder="How are you feeling?" />
                  </SelectTrigger>
                  <SelectContent>
                    {moodOptions.map((mood) => (
                      <SelectItem key={mood.value} value={mood.value}>
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${mood.color}`} />
                          {mood.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Tag className="h-4 w-4" /> Tags
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {commonTagOptions.map((tag) => (
                    <Badge
                      key={tag.value}
                      variant={newTags.includes(tag.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() =>
                        newTags.includes(tag.value) ? removeTag(tag.value) : addTag(tag.value)
                      }
                    >
                      {tag.label}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add custom tag..."
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(customTag);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => addTag(customTag)}
                    disabled={!customTag.trim()}
                  >
                    Add
                  </Button>
                </div>
                {newTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {newTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        {tagLabel(tag)}
                        <button
                          onClick={() => removeTag(tag)}
                          className="ml-1 hover:text-destructive"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditEntry(null); resetForm(); }}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Update Entry"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
