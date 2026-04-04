import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Truck, MapPin, Calculator } from "lucide-react";

function classifyZone(zip: string) {
  const clean = zip.replace(/\D/g, "").slice(0, 5);
  if (clean.length < 1) return { zone: "Unknown", region: "Unknown", lane: "Unknown", freightRisk: "Unknown" };
  const first = Number(clean[0]);

  // Heuristic based on likely distance from St. Rose, LA
  if ([7].includes(first)) {
    return { zone: "Zone A", region: "Gulf / Nearby South", lane: "Short-haul", freightRisk: "Low" };
  }
  if ([3, 6].includes(first)) {
    return { zone: "Zone B", region: "Southeast / South-Central", lane: "Regional", freightRisk: "Low-Medium" };
  }
  if ([1, 4, 5].includes(first)) {
    return { zone: "Zone C", region: "Midwest / Central / Mid-Atlantic", lane: "Mid-haul", freightRisk: "Medium" };
  }
  if ([0, 2, 8].includes(first)) {
    return { zone: "Zone D", region: "Northeast / Mountain", lane: "Long-haul", freightRisk: "High" };
  }
  if ([9].includes(first)) {
    return { zone: "Zone E", region: "West Coast", lane: "Long-haul", freightRisk: "High" };
  }
  return { zone: "Unknown", region: "Unknown", lane: "Unknown", freightRisk: "Unknown" };
}

function estimateFreight(orderValue: number, mode: string, zone: string) {
  const upsRanges: Record<string, [number, number]> = {
    "Zone A": [25, 50],
    "Zone B": [35, 70],
    "Zone C": [55, 100],
    "Zone D": [85, 150],
    "Zone E": [95, 170],
  };

  const ltlRanges: Record<string, [number, number]> = {
    "Zone A": [90, 130],
    "Zone B": [100, 150],
    "Zone C": [120, 180],
    "Zone D": [150, 230],
    "Zone E": [170, 260],
  };

  const handling: [number, number] = [10, 30];
  const ranges = mode === "ltl" ? ltlRanges : upsRanges;
  const freight = ranges[zone] || [0, 0];
  return {
    freightLow: freight[0],
    freightHigh: freight[1],
    totalLow: freight[0] + handling[0],
    totalHigh: freight[1] + handling[1],
    savings: orderValue * 0.025,
  };
}

function decide({ orderValue, mode, zone, palletizable }: { orderValue: number; mode: string; zone: string; palletizable: boolean }) {
  const est = estimateFreight(orderValue, mode, zone);
  const pctLow = est.totalLow / Math.max(orderValue, 1);
  const pctHigh = est.totalHigh / Math.max(orderValue, 1);

  if (orderValue >= 10000) {
    return {
      route: "TD Synnex → St. Rose",
      confidence: "High",
      reason: "Large orders usually justify the 2.5% cost advantage and absorb handling/freight well.",
      color: "green",
    };
  }

  if (orderValue < 5000) {
    return {
      route: "Distribution Management",
      confidence: "High",
      reason: "Savings are usually too small on sub-$5K orders once freight and handling are added.",
      color: "red",
    };
  }

  // Mid-order logic
  if (palletizable || mode === "ltl") {
    return {
      route: "TD Synnex → St. Rose",
      confidence: "Medium-High",
      reason: "Mid-size orders that can move palletized by LTL are usually the best candidates for routed fulfillment.",
      color: "green",
    };
  }

  if (["Zone D", "Zone E"].includes(zone) && mode === "ups") {
    return {
      route: "Distribution Management",
      confidence: "Medium-High",
      reason: "UPS on long-haul lanes often eats most or all of the 2.5% product savings on $5K–$10K orders.",
      color: "yellow",
    };
  }

  if (pctHigh <= 0.015) {
    return {
      route: "TD Synnex → St. Rose",
      confidence: "Medium",
      reason: "Estimated freight + handling remain below ~1.5% of order value, which should preserve enough spread.",
      color: "green",
    };
  }

  if (pctLow >= 0.02) {
    return {
      route: "Distribution Management",
      confidence: "Medium",
      reason: "Estimated freight + handling are at or above ~2% of order value, making the lane borderline or unattractive.",
      color: "red",
    };
  }

  return {
    route: "Manual Review",
    confidence: "Medium",
    reason: "This order sits in the gray zone. Check exact carrier quote before routing.",
    color: "yellow",
  };
}

function ColorBadge({ color, children }: { color: string; children: React.ReactNode }) {
  const cls =
    color === "green"
      ? "bg-green-100 text-green-800 border-green-200"
      : color === "red"
      ? "bg-red-100 text-red-800 border-red-200"
      : "bg-yellow-100 text-yellow-800 border-yellow-200";
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${cls}`}>{children}</span>;
}

export default function HPFreightZoneDecisionMap() {
  const [zip, setZip] = useState("");
  const [orderValue, setOrderValue] = useState("5000");
  const [mode, setMode] = useState("ups");
  const [palletizable, setPalletizable] = useState("no");

  const zoneInfo = useMemo(() => classifyZone(zip), [zip]);
  const numericOrderValue = Number(orderValue || 0);
  const est = useMemo(
    () => estimateFreight(numericOrderValue, mode, zoneInfo.zone),
    [numericOrderValue, mode, zoneInfo.zone]
  );
  const result = useMemo(
    () =>
      decide({
        orderValue: numericOrderValue,
        mode,
        zone: zoneInfo.zone,
        palletizable: palletizable === "yes",
      }),
    [numericOrderValue, mode, zoneInfo.zone, palletizable]
  );

  const spreadLow = est.savings - est.totalHigh;
  const spreadHigh = est.savings - est.totalLow;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">HP Freight Zone Decision Map</h1>
              <p className="mt-2 text-slate-600 max-w-3xl">
                Enter destination ZIP, order value, and shipment type to get a routing recommendation for
                <span className="font-semibold"> Distribution Management vs. TD Synnex → St. Rose</span>.
              </p>
            </div>
            <Badge variant="secondary" className="text-sm px-3 py-1 rounded-full">Heuristic v1</Badge>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="rounded-3xl shadow-sm lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Destination ZIP</Label>
                <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 98433" />
              </div>

              <div className="space-y-2">
                <Label>Order Value ($)</Label>
                <Input value={orderValue} onChange={(e) => setOrderValue(e.target.value.replace(/[^\d.]/g, ""))} placeholder="5000" />
              </div>

              <div className="space-y-2">
                <Label>Shipping Method</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ups">UPS Ground / Small Parcel</SelectItem>
                    <SelectItem value="ltl">LTL / Estes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Palletizable?</Label>
                <Select value={palletizable} onValueChange={setPalletizable}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-2xl bg-slate-50 border p-4 text-sm text-slate-600">
                Assumptions: 2.5% TD Synnex product advantage, St. Rose handling cost of roughly $10–$30,
                and lane-based freight estimates. This should be refined later with actual UPS and Estes data.
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card className="rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> Lane Classification</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Zone</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.zone}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Region</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.region}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Lane</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.lane}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Freight Risk</div>
                    <div className="mt-1 text-xl font-semibold">{zoneInfo.freightRisk}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Routing Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <ColorBadge color={result.color}>{result.route}</ColorBadge>
                  <ColorBadge color={result.color}>Confidence: {result.confidence}</ColorBadge>
                </div>
                <p className="text-slate-700">{result.reason}</p>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card className="rounded-3xl shadow-sm">
                <CardHeader>
                  <CardTitle>Estimated Economics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between"><span>Product Savings (2.5%)</span><span className="font-semibold">${est.savings.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span>Freight Estimate</span><span className="font-semibold">${est.freightLow.toFixed(0)}–${est.freightHigh.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span>Total Added Cost</span><span className="font-semibold">${est.totalLow.toFixed(0)}–${est.totalHigh.toFixed(0)}</span></div>
                  <div className="mt-3 border-t pt-3 flex justify-between text-base"><span>Estimated Spread</span><span className="font-bold">${spreadLow.toFixed(0)} to ${spreadHigh.toFixed(0)}</span></div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl shadow-sm">
                <CardHeader>
                  <CardTitle>Operating Rules</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /><span><strong>$10K+</strong>: default to TD Synnex → St. Rose.</span></div>
                  <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-yellow-600" /><span><strong>$5K–$10K</strong>: decision depends on lane and shipping mode.</span></div>
                  <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" /><span><strong>UPS + long-haul</strong> lanes often favor DM on mid-sized orders.</span></div>
                  <div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /><span><strong>Pallet / LTL</strong> usually improves the TD Synnex case.</span></div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
