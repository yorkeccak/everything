import { createClient } from "@supabase/supabase-js";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") || "",
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // Get session with messages
  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
    });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return new Response(JSON.stringify({ error: messagesError.message }), {
      status: 500,
    });
  }

  return new Response(
    JSON.stringify({
      session,
      messages: messages.map((msg) => {
        // Handle both legacy format ({parts, contextResources}) and new format (parts array with context in token_usage)
        const content = msg.content;
        let parts: any = content;
        let contextResources: any = null;

        if (
          content &&
          typeof content === "object" &&
          !Array.isArray(content) &&
          "parts" in content
        ) {
          parts = (content as any).parts;
          contextResources =
            (content as any).contextResources ||
            (content as any).context_resources ||
            null;
        } else if (!Array.isArray(content)) {
          // Normalize string or other shapes into text part array
          if (typeof content === "string") {
            parts = [{ type: "text", text: content }];
          }
        }

        if (!Array.isArray(parts)) {
          parts = [];
        }

        if (!contextResources) {
          const usage =
            msg.token_usage && typeof msg.token_usage === "object"
              ? msg.token_usage
              : msg.tokenUsage && typeof msg.tokenUsage === "object"
              ? msg.tokenUsage
              : null;

          if (usage) {
            contextResources =
              usage.contextResources || usage.context_resources || null;
          }
        }

        return {
          id: msg.id,
          role: msg.role,
          parts: parts,
          contextResources: contextResources,
          toolCalls: msg.tool_calls,
          createdAt: msg.created_at,
        };
      }),
    })
  );
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") || "",
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const { error } = await supabase
    .from("chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ success: true }));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const { title } = await req.json();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") || "",
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const { error } = await supabase
    .from("chat_sessions")
    .update({ title })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ success: true }));
}
