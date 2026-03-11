import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MarketingHeader } from "@/components/MarketingHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function ContactPage() {
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    experienceLevel: "Beginner",
    hasAppAccount: false,
    message: "",
  });

  const mutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/contact", data),
    onSuccess: () => {
      setStatus("success");
      setFormData({
        name: "",
        email: "",
        experienceLevel: "Beginner",
        hasAppAccount: false,
        message: "",
      });
    },
    onError: () => setStatus("error"),
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">
        <section className="container mx-auto px-4 py-10 md:px-6 md:py-16">
          <div className="max-w-xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Start trading for us.</CardTitle>
                <CardDescription>
                  Tell us about your experience and why you're ready to be funded.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {status === "success" ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Application Received!</h3>
                    <p className="text-muted-foreground mb-4">
                      Thanks for your interest! We'll review your information and get in touch soon.
                    </p>
                    <Button variant="outline" onClick={() => setStatus("idle")}>
                      Submit Another
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        placeholder="Your full name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                        placeholder="you@example.com"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="experienceLevel">Experience Level</Label>
                      <Select
                        value={formData.experienceLevel}
                        onValueChange={(value) => setFormData({ ...formData, experienceLevel: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select your experience level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Beginner">Beginner</SelectItem>
                          <SelectItem value="Intermediate">Intermediate</SelectItem>
                          <SelectItem value="Pro">Pro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="hasAppAccount"
                        checked={formData.hasAppAccount}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, hasAppAccount: checked === true })
                        }
                      />
                      <Label htmlFor="hasAppAccount" className="text-sm font-normal cursor-pointer">
                        I have a TradeQuip account
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">Why are you ready to be funded?</Label>
                      <Textarea
                        id="message"
                        name="message"
                        rows={4}
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        required
                        placeholder="Tell us about your trading experience, strategy, and goals..."
                      />
                    </div>

                    <Button type="submit" className="w-full" disabled={mutation.isPending}>
                      {mutation.isPending ? "Sending..." : "Submit Application"}
                    </Button>

                    {status === "error" && (
                      <div className="flex items-center gap-2 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4" />
                        <span>Something went wrong. Please try again later.</span>
                      </div>
                    )}
                  </form>
                )}
              </CardContent>
            </Card>

            <div className="mt-8 text-xs text-muted-foreground text-center space-y-2">
              <p>Trading for this website is purely for research and training purposes only. 
              Any &amp; all trading is purely virtual unless stated otherwise.</p>
              <p>© {new Date().getFullYear()} TradeQuip. All rights reserved.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
